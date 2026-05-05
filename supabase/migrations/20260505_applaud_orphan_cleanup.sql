-- Polymorphic applauds (member, target_type, target_id) carry no FK
-- on target_id by design — the target lives in different tables per
-- target_type (projects / comments / community_posts). The downside:
-- delete a project or a comment, and its applauds are stranded as
-- orphans pointing at a uuid no row owns. UI surfaces the dangling
-- row as "product f6e31e9d" / "comment d8a8ad00" because the resolver
-- finds no name to attach.
--
-- Two-part fix:
--   1. Backfill cleanup · drop the orphans that already exist.
--   2. Cascading-delete triggers on projects + comments so future
--      target deletions sweep their applauds in the same transaction.
--
-- build_log / stack / brief / recommit fall under community_posts —
-- adding their cleanup trigger now too so the surface is uniform
-- whether or not those types accrue applauds today.

-- 1. Backfill — drop existing orphans.
DELETE FROM applauds a
 WHERE a.target_type = 'product'
   AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = a.target_id);

DELETE FROM applauds a
 WHERE a.target_type = 'comment'
   AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.id = a.target_id);

DELETE FROM applauds a
 WHERE a.target_type IN ('build_log', 'stack', 'brief', 'recommit')
   AND NOT EXISTS (SELECT 1 FROM community_posts p WHERE p.id = a.target_id);

-- 2. Cascading-delete triggers · keep applauds in lock step with
--    their targets going forward.
CREATE OR REPLACE FUNCTION public.cascade_applauds_for_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM applauds
   WHERE target_type = 'product'
     AND target_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_applauds_for_project ON public.projects;
CREATE TRIGGER trg_cascade_applauds_for_project
  AFTER DELETE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION cascade_applauds_for_project();

CREATE OR REPLACE FUNCTION public.cascade_applauds_for_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM applauds
   WHERE target_type = 'comment'
     AND target_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_applauds_for_comment ON public.comments;
CREATE TRIGGER trg_cascade_applauds_for_comment
  AFTER DELETE ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION cascade_applauds_for_comment();

CREATE OR REPLACE FUNCTION public.cascade_applauds_for_community_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM applauds
   WHERE target_type IN ('build_log', 'stack', 'brief', 'recommit')
     AND target_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_applauds_for_community_post ON public.community_posts;
CREATE TRIGGER trg_cascade_applauds_for_community_post
  AFTER DELETE ON public.community_posts
  FOR EACH ROW
  EXECUTE FUNCTION cascade_applauds_for_community_post();
