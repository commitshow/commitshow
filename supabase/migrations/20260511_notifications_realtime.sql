-- Add notifications to the supabase_realtime publication.
--
-- The TicketGiftCelebration modal subscribes to INSERT events on
-- notifications (filtered by recipient_id) so a gift sent while the
-- recipient is online surfaces the center modal immediately. Without
-- the table in the publication, the channel.subscribe() succeeds but
-- no events fire — which is exactly what we observed (gift sent +
-- DB row inserted + notification row inserted, but no client push).
--
-- ALTER PUBLICATION ADD TABLE is idempotent in a sense — re-applying
-- after the table is already in the publication errors. Wrap in a
-- DO block + check pg_publication_tables to make this re-runnable.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;
