-- app_feature_flags · admin-flippable booleans for soft-launch gating.
--
-- First flag: tokens_public · controls whether the Tokens primary-nav
-- link is visible to non-admins. The /tokens page itself stays
-- reachable by direct URL (so admins can share preview links), but
-- the nav surface only appears once admin flips this on.
--
-- Pattern intentionally simple — a key/value boolean store that any
-- authenticated user can SELECT (so the Nav can read the flag without
-- a server round-trip), but only admins can UPDATE/INSERT. New flags
-- get added via INSERT in a follow-up migration · UI lists every row.

CREATE TABLE IF NOT EXISTS public.app_feature_flags (
  key         text         PRIMARY KEY,
  enabled     boolean      NOT NULL DEFAULT false,
  description text,
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  updated_by  uuid         REFERENCES public.members(id) ON DELETE SET NULL
);

ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;

-- Anyone can read · the Nav reads this on every render and we don't
-- want to gate it behind auth.uid() (would mean Nav fails for logged-out
-- visitors). Values are non-sensitive booleans.
DROP POLICY IF EXISTS app_feature_flags_select_all ON public.app_feature_flags;
CREATE POLICY app_feature_flags_select_all
  ON public.app_feature_flags
  FOR SELECT
  USING (true);

-- Admin-only writes.
DROP POLICY IF EXISTS app_feature_flags_admin_write ON public.app_feature_flags;
CREATE POLICY app_feature_flags_admin_write
  ON public.app_feature_flags
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.members WHERE members.id = auth.uid() AND members.is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.members WHERE members.id = auth.uid() AND members.is_admin = true)
  );

GRANT SELECT ON public.app_feature_flags TO anon, authenticated;
GRANT ALL    ON public.app_feature_flags TO service_role;

-- Seed: tokens_public defaults OFF. Admin flips it on once the
-- token leaderboard has enough verified entries to be useful.
INSERT INTO public.app_feature_flags (key, enabled, description)
VALUES ('tokens_public', false,
  'Show /tokens leaderboard link in primary nav for non-admins. Page itself is always reachable by URL.')
ON CONFLICT (key) DO NOTHING;

-- Bump updated_at automatically on writes so the admin UI can show
-- 'last changed' without us threading it through manually.
CREATE OR REPLACE FUNCTION public.touch_app_feature_flags_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_app_feature_flags ON public.app_feature_flags;
CREATE TRIGGER trg_touch_app_feature_flags
  BEFORE UPDATE ON public.app_feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_app_feature_flags_updated_at();
