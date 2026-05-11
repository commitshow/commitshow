-- project_pulse_stats v5 · add viewer_involved flag.
--
-- The COMMENTS notification dot was owner-only as a first cut, but
-- threads where I commented and got a reply also deserve the dot
-- (I want to know someone responded). v5 returns a viewer_involved
-- boolean — true when auth.uid() has any comment row on this
-- project. Caller (CommunityPulseStrip) ORs this with isOwner to
-- decide whether the dot is relevant.

CREATE OR REPLACE FUNCTION public.project_pulse_stats(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    me AS (SELECT auth.uid() AS uid),
    a AS (
      SELECT COUNT(*)::int AS n
      FROM applauds
      WHERE target_type = 'product' AND target_id = p_project_id
    ),
    c AS (
      SELECT COUNT(*)::int AS n
      FROM comments
      WHERE project_id = p_project_id
    ),
    f AS (
      SELECT
        COUNT(*)::int                              AS n,
        ROUND(AVG(predicted_score)::numeric, 0)::int AS avg_predicted
      FROM votes
      WHERE project_id = p_project_id
    ),
    v AS (
      SELECT COUNT(*)::int AS n
      FROM visitor_hits
      WHERE path LIKE '/projects/' || p_project_id::text || '%'
    ),
    inv AS (
      -- viewer_involved = the caller has any comment on this project
      SELECT EXISTS(
        SELECT 1 FROM comments c2, me
        WHERE c2.project_id = p_project_id
          AND c2.member_id  = me.uid
          AND me.uid IS NOT NULL
      ) AS involved
    )
  SELECT jsonb_build_object(
    'applauds',         (SELECT n FROM a),
    'comments',         (SELECT n FROM c),
    'forecasts',        (SELECT n FROM f),
    'forecast_avg',     (SELECT avg_predicted FROM f),
    'views',            (SELECT n FROM v),
    'viewer_involved',  (SELECT involved FROM inv)
  );
$$;
