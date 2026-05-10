-- Audit-then-audition split · §1-A ⑥ verb pair (Audit / Audition)
--
-- Until now /submit bundled four actions into one transaction:
--   project info → brief → payment (if 4th+) → audit → status='active' on ladder
-- New visitors hit the Stripe gate before they ever saw an audit report,
-- so the value-prove step happened *after* the commitment step. This
-- migration introduces the 'backstage' state — audit done, owner-private,
-- not on the league — so the funnel becomes:
--
--   audit (free, always runs) → backstage → owner reviews → audition CTA
--   → ticket or Stripe → 'active' on ladder
--
-- Status semantics (post-migration):
--   · 'preview'   · anonymous URL fast lane / CLI walk-on (creator_id NULL)
--   · 'backstage' · audit done, OWNED but private (creator_id = owner)  ← NEW
--   · 'active'    · auditioned, public on ladder (creator_id = owner)
--   · 'graduated' / 'valedictorian' / 'retry' · season-end states (existing)
--
-- Privacy model: backstage rows are owner-private. Public SELECT must
-- exclude them. The existing "Anyone can read projects" policy USING
-- (true) leaked the entire row to anon — replaced with two policies
-- below.
--
-- Existing call sites already filter by status IN ('active',
-- 'graduated', 'valedictorian') for ladder/feed/leaderboard, so they
-- automatically exclude 'backstage'. Encore trigger
-- (maybe_issue_encore) also gates on those statuses, so a backstage
-- project that crosses 85 does NOT issue the encore until it
-- auditions onto the stage.
--
-- No CHECK constraint on projects.status today, so adding a new value
-- is data-only · no DDL on the column itself.

-- ── RLS · split the public read into two policies ──────────────────

DROP POLICY IF EXISTS "Anyone can read projects" ON public.projects;

CREATE POLICY "Public reads non-backstage projects"
  ON public.projects
  FOR SELECT
  USING (status <> 'backstage');

CREATE POLICY "Owners read their backstage projects"
  ON public.projects
  FOR SELECT
  USING (status = 'backstage' AND creator_id = auth.uid());

-- service_role bypasses RLS, so analyze-project / auto-tweet / cron
-- workers continue to see backstage rows for processing.

-- ── Index · owner backstage lookup ─────────────────────────────────
-- /me's backstage list query: WHERE creator_id = $me AND status = 'backstage'
-- Partial index keeps the index small (most rows are 'preview' or 'active').
CREATE INDEX IF NOT EXISTS idx_projects_backstage_creator
  ON public.projects (creator_id, created_at DESC)
  WHERE status = 'backstage';

-- ── Helper · count_backstage(member_id) ────────────────────────────
-- Used by /me and SubmitForm to display "X projects waiting backstage".
CREATE OR REPLACE FUNCTION public.count_backstage(p_member_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM projects
  WHERE creator_id = p_member_id AND status = 'backstage';
$$;

GRANT EXECUTE ON FUNCTION public.count_backstage(uuid) TO authenticated, service_role;

-- ── audition_project(p_project_id) RPC ─────────────────────────────
-- Promotes a backstage project to 'active' (= on stage). Caller must
-- own the project. The RPC checks ticket availability (free quota or
-- paid_audits_credit) and decrements one. Returns:
--   { ok: true,  used: 'free' | 'credit' }     · promoted, no Stripe needed
--   { ok: false, reason: 'no_ticket' }         · caller must purchase via Stripe
--   { ok: false, reason: 'not_owner' }
--   { ok: false, reason: 'wrong_state' }
--
-- The 'free quota' here is computed as (FREE_QUOTA - prior_active_count).
-- FREE_QUOTA constant matches checkRegistrationEligibility on the client.

CREATE OR REPLACE FUNCTION public.audition_project(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id  uuid := auth.uid();
  v_creator    uuid;
  v_status     text;
  v_prior      int;
  v_free_quota int := 3;    -- §16.2 first 3 free
  v_credit     int;
BEGIN
  IF v_member_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT creator_id, status INTO v_creator, v_status
  FROM projects WHERE id = p_project_id;

  IF v_creator IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_creator <> v_member_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  IF v_status <> 'backstage' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_state');
  END IF;

  -- Try free quota first (audited projects already on stage count toward quota).
  SELECT COUNT(*) INTO v_prior
  FROM projects
  WHERE creator_id = v_member_id
    AND status IN ('active', 'graduated', 'valedictorian', 'retry');

  IF v_prior < v_free_quota THEN
    UPDATE projects SET status = 'active'
     WHERE id = p_project_id AND status = 'backstage';
    RETURN jsonb_build_object('ok', true, 'used', 'free',
                              'tickets_remaining', GREATEST(0, v_free_quota - v_prior - 1));
  END IF;

  -- Free quota exhausted · try paid credit.
  SELECT paid_audits_credit INTO v_credit FROM members WHERE id = v_member_id;
  IF v_credit > 0 THEN
    UPDATE members SET paid_audits_credit = paid_audits_credit - 1
     WHERE id = v_member_id AND paid_audits_credit > 0;
    UPDATE projects SET status = 'active'
     WHERE id = p_project_id AND status = 'backstage';
    RETURN jsonb_build_object('ok', true, 'used', 'credit',
                              'tickets_remaining', v_credit - 1);
  END IF;

  -- Out of free quota AND no credit · client must invoke Stripe checkout.
  RETURN jsonb_build_object('ok', false, 'reason', 'no_ticket');
END;
$$;

GRANT EXECUTE ON FUNCTION public.audition_project(uuid) TO authenticated, service_role;

-- ── Helper · ticket_balance(member_id) ─────────────────────────────
-- Used by SubmitForm/me to show "X tickets remaining" before the user
-- commits to auditioning a backstage project.
CREATE OR REPLACE FUNCTION public.ticket_balance(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free_quota   int := 3;
  v_prior_active int;
  v_credit       int;
BEGIN
  SELECT COUNT(*) INTO v_prior_active
  FROM projects
  WHERE creator_id = p_member_id
    AND status IN ('active', 'graduated', 'valedictorian', 'retry');

  SELECT paid_audits_credit INTO v_credit FROM members WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'free_remaining', GREATEST(0, v_free_quota - v_prior_active),
    'paid_credit',    COALESCE(v_credit, 0),
    'total_tickets',  GREATEST(0, v_free_quota - v_prior_active) + COALESCE(v_credit, 0),
    'free_quota',     v_free_quota,
    'prior_active',   v_prior_active
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ticket_balance(uuid) TO authenticated, service_role;
