-- Visitor analytics · 인간 방문자 hit 로그.
--
-- AEO (ai_crawler_hits) 와 같은 middleware 가 비-bot UA 의 page-load 를
-- visitor_hits 에 기록. 정적 자산 (.css/.js/.png/등) 과 명백한 bot UA
-- (crawler/spider/headless/etc) 는 스킵 · 실제 사람 페이지뷰만 누적.
--
-- privacy: IP djb2 해시 · session 은 day-rolling fingerprint 로 cookie 없이
-- 'unique-ish' visitor 추정 · UA / Referer / Country 는 표준 헤더만.
--
-- 운영 메트릭:
--   · 일별 / 시간별 페이지뷰 + unique visitor 추정
--   · top pages · top referrer host · top country
--   · device class (mobile/tablet/desktop) · browser family
--   · session-level bounce 추정 (single-path session = bounce)

CREATE TABLE IF NOT EXISTS public.visitor_hits (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_hash    text         NOT NULL,           -- djb2(ip + day_floor + ua_class) · UNIQUE-ish per day per device
  ip_hash         text         NOT NULL,
  path            text         NOT NULL,
  referer_host    text,                             -- e.g. 'google.com', 'x.com', 't.co'
  referer_kind    text         NOT NULL,           -- 'search' | 'social' | 'direct' | 'internal' | 'other'
  country         text,                             -- ISO-3166-1-alpha-2 from CF-IPCountry
  device          text         NOT NULL DEFAULT 'desktop' CHECK (device IN ('mobile','tablet','desktop','bot','unknown')),
  browser         text,                             -- 'chrome' | 'safari' | 'firefox' | 'edge' | etc
  status_code     integer,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_hits_created    ON public.visitor_hits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_hits_visitor    ON public.visitor_hits (visitor_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_hits_path       ON public.visitor_hits (path);
CREATE INDEX IF NOT EXISTS idx_visitor_hits_ref_kind   ON public.visitor_hits (referer_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_hits_country    ON public.visitor_hits (country);

ALTER TABLE public.visitor_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read visitor_hits" ON public.visitor_hits;
CREATE POLICY "admins read visitor_hits"
  ON public.visitor_hits
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM members WHERE members.id = auth.uid() AND members.is_admin));

GRANT SELECT ON public.visitor_hits TO authenticated;
GRANT ALL    ON public.visitor_hits TO service_role;

-- ── Aggregation RPCs ──────────────────────────────────────────────

-- Daily visitor + pageview counts. Unique visitors estimated by
-- count(distinct visitor_hash) within each day.
CREATE OR REPLACE FUNCTION public.visitor_daily_counts(
  p_days int DEFAULT 14
) RETURNS TABLE (
  day             date,
  pageviews       bigint,
  unique_visitors bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(*)                              AS pageviews,
    COUNT(DISTINCT visitor_hash)          AS unique_visitors
  FROM visitor_hits
  WHERE created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.visitor_daily_counts(int) TO authenticated, service_role;

-- Top pages by pageview count + unique visitors.
CREATE OR REPLACE FUNCTION public.visitor_top_pages(
  p_days  int DEFAULT 7,
  p_limit int DEFAULT 20
) RETURNS TABLE (
  path            text,
  pageviews       bigint,
  unique_visitors bigint,
  last_hit        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    path,
    COUNT(*)                     AS pageviews,
    COUNT(DISTINCT visitor_hash) AS unique_visitors,
    MAX(created_at)              AS last_hit
  FROM visitor_hits
  WHERE created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY path
  ORDER BY pageviews DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.visitor_top_pages(int, int) TO authenticated, service_role;

-- Top referrer hosts grouped by kind. 'direct' (no referer) is
-- expected to be a large slice unless we have heavy social inflow.
CREATE OR REPLACE FUNCTION public.visitor_top_referers(
  p_days  int DEFAULT 7,
  p_limit int DEFAULT 20
) RETURNS TABLE (
  referer_host    text,
  referer_kind    text,
  pageviews       bigint,
  unique_visitors bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(referer_host, '(direct)') AS referer_host,
    referer_kind,
    COUNT(*)                           AS pageviews,
    COUNT(DISTINCT visitor_hash)       AS unique_visitors
  FROM visitor_hits
  WHERE created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY 1, 2
  ORDER BY pageviews DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.visitor_top_referers(int, int) TO authenticated, service_role;

-- Country breakdown · top N + remainder.
CREATE OR REPLACE FUNCTION public.visitor_top_countries(
  p_days  int DEFAULT 7,
  p_limit int DEFAULT 12
) RETURNS TABLE (
  country         text,
  pageviews       bigint,
  unique_visitors bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(country, '(unknown)') AS country,
    COUNT(*)                       AS pageviews,
    COUNT(DISTINCT visitor_hash)   AS unique_visitors
  FROM visitor_hits
  WHERE created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY 1
  ORDER BY pageviews DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.visitor_top_countries(int, int) TO authenticated, service_role;

-- Device + browser mix · for layout / browser-test priority decisions.
CREATE OR REPLACE FUNCTION public.visitor_device_mix(
  p_days int DEFAULT 7
) RETURNS TABLE (
  device          text,
  browser         text,
  pageviews       bigint,
  unique_visitors bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    device,
    COALESCE(browser, '(unknown)') AS browser,
    COUNT(*)                       AS pageviews,
    COUNT(DISTINCT visitor_hash)   AS unique_visitors
  FROM visitor_hits
  WHERE created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY 1, 2
  ORDER BY pageviews DESC;
$$;

GRANT EXECUTE ON FUNCTION public.visitor_device_mix(int) TO authenticated, service_role;

-- Bounce rate · session = visitor_hash within a day · bounced if they
-- visited only one path. Not perfect (no real session timeout) but a
-- useful directional signal.
CREATE OR REPLACE FUNCTION public.visitor_bounce_summary(
  p_days int DEFAULT 7
) RETURNS TABLE (
  total_sessions   bigint,
  bounce_sessions  bigint,
  bounce_pct       numeric,
  avg_pages        numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sessions AS (
    SELECT visitor_hash, COUNT(DISTINCT path) AS distinct_paths, COUNT(*) AS pageviews
    FROM visitor_hits
    WHERE created_at >= (now() - (p_days || ' days')::interval)
    GROUP BY visitor_hash
  )
  SELECT
    COUNT(*)                                                      AS total_sessions,
    COUNT(*) FILTER (WHERE distinct_paths = 1)                    AS bounce_sessions,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE distinct_paths = 1)::numeric
            / NULLIF(COUNT(*), 0)::numeric
    , 1)                                                          AS bounce_pct,
    ROUND(AVG(pageviews)::numeric, 2)                             AS avg_pages
  FROM sessions;
$$;

GRANT EXECUTE ON FUNCTION public.visitor_bounce_summary(int) TO authenticated, service_role;
