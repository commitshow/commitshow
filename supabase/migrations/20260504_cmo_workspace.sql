-- CMO's Room · single-row workspace holding strategic insights +
-- marketing roadmap. Both fields are markdown text; admin edits
-- directly in textarea OR via chat (M updates the doc, rewrites
-- the whole field via Claude). The Insights field captures what M
-- is observing about audience / performance / opportunities. The
-- Roadmap field captures the next N weeks of marketing plan.
--
-- The freeform tweet generator + the 5 trigger templates read this
-- workspace at request time so generated copy is aligned with the
-- current strategy.

CREATE TABLE IF NOT EXISTS public.cmo_workspace (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  insights_md  text NOT NULL DEFAULT '',
  roadmap_md   text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.members(id) ON DELETE SET NULL
);

ALTER TABLE public.cmo_workspace ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read cmo_workspace"  ON public.cmo_workspace;
DROP POLICY IF EXISTS "admins write cmo_workspace" ON public.cmo_workspace;
CREATE POLICY "admins read cmo_workspace"  ON public.cmo_workspace FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND is_admin));
CREATE POLICY "admins write cmo_workspace" ON public.cmo_workspace FOR ALL
  USING (EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND is_admin));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cmo_workspace TO authenticated;
GRANT ALL ON public.cmo_workspace TO service_role;

-- Seed the single row with skeleton headings so the surface isn't blank
-- the first time it loads.
INSERT INTO public.cmo_workspace (id, insights_md, roadmap_md) VALUES (1,
$$## Audience snapshot
_(empty · ask M to populate)_

## What's working
_(empty)_

## What's not
_(empty)_

## Opportunities this week
_(empty)_$$,
$$## This week (W1 · day-zero push)
- ship 7-post draft batch (Pillar A · D heavy)
- pin tweet · self-audit screenshot of commit.show repo
- daily 1 reactive reply (Pillar B)

## Next week (W2)
- _(fill in based on W1 results)_

## Month-1 milestones
- 100 followers
- 1 retweet from a tooling account (Cursor / Anthropic / Lovable)
- 5 organic /submit conversions from X UTM

## Phase progression (CMO.md §6)
- Phase 1 (draft-only) · day 0 - day 14 · current
- Phase 2 (scheduled queue) · day 15 - day 30
- Phase 3 (autopost low-stakes) · day 31+
- Phase 4 (autopost full) · conditional$$)
ON CONFLICT (id) DO NOTHING;

-- Trigger: bump updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.cmo_workspace_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_cmo_workspace_updated_at ON public.cmo_workspace;
CREATE TRIGGER trg_cmo_workspace_updated_at BEFORE UPDATE ON public.cmo_workspace
  FOR EACH ROW EXECUTE FUNCTION public.cmo_workspace_set_updated_at();
