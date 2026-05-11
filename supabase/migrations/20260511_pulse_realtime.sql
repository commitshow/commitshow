-- Add applauds · comments · votes to supabase_realtime publication.
--
-- Drives the CommunityPulseStrip live-refresh: when ANYONE applauds /
-- comments / forecasts on a project, all viewers' pulse tile counts
-- update without a page reload. notifications was added earlier in
-- 20260511_notifications_realtime.sql for the same reason on the
-- gift-celebration modal.
--
-- Idempotent guard via pg_publication_tables · safe to re-apply.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['applauds', 'comments', 'votes']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
