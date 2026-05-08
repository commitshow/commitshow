-- AEO 추적 · AI crawler hits 로그.
--
-- Cloudflare AI Crawl Control 이 zone 단위 요청 통계를 갖고 있지만
-- 우리 쪽 DB 에 별도로 쌓아두면:
--   · 시계열 분석 (월간 / 주간 / 시간대)
--   · 어떤 AI bot 이 어떤 경로를 얼마나 보는지 더 깊이
--   · admin /admin > AEO 탭에서 즉시 확인
--   · 직접 surfacing — AnSwer Engine Optimization 측면 자체 메트릭
--
-- Pages Function root middleware (functions/_middleware.ts) 가 매 요청
-- UA 검사 → 알려진 AI crawler 패턴 매치 → service_role 로 fire-and-forget
-- INSERT (waitUntil). 사용자 응답 latency 영향 0.

CREATE TABLE IF NOT EXISTS public.ai_crawler_hits (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  ua_kind       text         NOT NULL,              -- canonicalized: gptbot · claudebot · perplexitybot · ...
  ua_full       text,                                -- raw User-Agent (truncated 240ch)
  path          text         NOT NULL,              -- request path (truncated 200ch)
  status_code   integer,                             -- response status, may be null on error path
  ip_hash       text,                                -- djb2(ip) string · privacy
  referer_host  text,                                -- e.g. 'chat.openai.com' if Referer present
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- Read-path indexes · admin queries focus on time + crawler aggregations.
CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_created
  ON public.ai_crawler_hits (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_kind_created
  ON public.ai_crawler_hits (ua_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_path
  ON public.ai_crawler_hits (path);

ALTER TABLE public.ai_crawler_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read ai_crawler_hits" ON public.ai_crawler_hits;
CREATE POLICY "admins read ai_crawler_hits"
  ON public.ai_crawler_hits
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM members WHERE members.id = auth.uid() AND members.is_admin));

GRANT SELECT ON public.ai_crawler_hits TO authenticated;
GRANT ALL    ON public.ai_crawler_hits TO service_role;

-- Aggregation RPCs · cheap reads for the admin AEO tab.

-- (1) Last N days · crawler-by-day counts · stacked-area chart fodder.
CREATE OR REPLACE FUNCTION public.ai_crawler_daily_counts(
  p_days int DEFAULT 14
) RETURNS TABLE (
  day      date,
  ua_kind  text,
  hits     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    ua_kind,
    COUNT(*) AS hits
  FROM ai_crawler_hits
  WHERE created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY 1, 2
  ORDER BY 1 DESC, 3 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.ai_crawler_daily_counts(int) TO authenticated, service_role;

-- (2) Top paths in window · "what's getting crawled most?"
CREATE OR REPLACE FUNCTION public.ai_crawler_top_paths(
  p_days  int DEFAULT 7,
  p_limit int DEFAULT 20
) RETURNS TABLE (
  path       text,
  hits       bigint,
  crawlers   int,
  last_hit   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    path,
    COUNT(*)             AS hits,
    COUNT(DISTINCT ua_kind)::int AS crawlers,
    MAX(created_at)      AS last_hit
  FROM ai_crawler_hits
  WHERE created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY path
  ORDER BY hits DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.ai_crawler_top_paths(int, int) TO authenticated, service_role;

-- (3) Crawler mix · % share over window · helps spot 'are AI engines
--     finding us in proportion?' (e.g. 80% Applebot · 0% ClaudeBot
--     would mean robots.txt or auth issue specific to Anthropic).
CREATE OR REPLACE FUNCTION public.ai_crawler_mix(
  p_days int DEFAULT 7
) RETURNS TABLE (
  ua_kind   text,
  hits      bigint,
  share_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH window_hits AS (
    SELECT ua_kind FROM ai_crawler_hits
    WHERE created_at >= (now() - (p_days || ' days')::interval)
  ),
  total AS (SELECT COUNT(*)::numeric AS n FROM window_hits)
  SELECT
    w.ua_kind,
    COUNT(*) AS hits,
    ROUND((COUNT(*)::numeric / NULLIF((SELECT n FROM total), 0)) * 100, 1) AS share_pct
  FROM window_hits w
  GROUP BY w.ua_kind
  ORDER BY hits DESC;
$$;

GRANT EXECUTE ON FUNCTION public.ai_crawler_mix(int) TO authenticated, service_role;
