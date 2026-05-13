-- ───────────────────────────────────────────────────────────────────────────
-- audit_frame_prevalence() · public RPC for landing "What we catch" carousel
-- ───────────────────────────────────────────────────────────────────────────
-- Aggregates the 14 AI Coder vibe-concerns frames across the most recent
-- snapshot per project (skipping preview-lane status='preview' so the
-- denominator reflects real auditioned products, not anonymous walk-ons).
-- Each frame returns (concerned_count, total_count, prevalence_pct,
-- frame_key, label, hint).
--
-- The detection key varies per frame — some use boolean `gap`, others
-- `needs_attention`, others `total > 0`, observability uses the inverse
-- (`detected = false` is the concern). We encode that inside the RPC so
-- the frontend gets a uniform shape.
--
-- SECURITY DEFINER + grant to anon/authenticated · the aggregate exposes
-- only counts and labels, no per-project data.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function audit_frame_prevalence()
returns table (
  frame_key       text,
  label           text,
  hint            text,
  concerned_count int,
  total_count     int,
  prevalence_pct  int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  total int;
begin
  -- Denominator · latest snapshot per project, excluding preview-lane.
  -- Walk-ons and URL fast lane share status='preview' and shouldn't pull
  -- the headline % around (they often lack repo signals → false zeros).
  with latest as (
    select distinct on (s.project_id) s.project_id, s.github_signals
    from analysis_snapshots s
    join projects p on p.id = s.project_id
    where p.status <> 'preview'
      and s.github_signals is not null
      and s.github_signals -> 'vibe_concerns' is not null
    order by s.project_id, s.created_at desc
  )
  select count(*) into total from latest;

  if total = 0 then
    return;
  end if;

  -- Build the 14-row result set. Each frame's concerned-condition lives
  -- in its own subquery so we can swap detection keys (gap vs total vs
  -- needs_attention vs inverse) without losing the uniform output shape.
  return query
    with latest as (
      select distinct on (s.project_id) s.project_id, s.github_signals
      from analysis_snapshots s
      join projects p on p.id = s.project_id
      where p.status <> 'preview'
        and s.github_signals is not null
        and s.github_signals -> 'vibe_concerns' is not null
      order by s.project_id, s.created_at desc
    ),
    frames as (
      -- Frame 1 · RLS gaps
      select 'rls_gaps'::text as frame_key,
             'Missing RLS policies'::text as label,
             'Supabase tables left wide open · the most common audit hit'::text as hint,
             ((github_signals->'vibe_concerns'->'rls_gaps'->>'gap_estimate')::int > 0) as concerned
        from latest
      union all
      -- Frame 2 · Secret exposure
      select 'secret_exposure',
             'Secrets leaked to client',
             'API keys or tokens shipped to the browser bundle',
             ((github_signals->'vibe_concerns'->'secret_exposure'->>'total')::int > 0)
        from latest
      union all
      -- Frame 3 · Webhook idempotency
      select 'webhook_idempotency',
             'Webhook retries unsafe',
             'Stripe / GitHub / Slack retries can fire your handler twice',
             ((github_signals->'vibe_concerns'->'webhook_idempotency'->>'gap')::boolean = true)
        from latest
      union all
      -- Frame 4 · Webhook signature
      select 'webhook_signature',
             'Webhook signature unchecked',
             'Anyone can POST to your webhook endpoint as if it were Stripe',
             ((github_signals->'vibe_concerns'->'webhook_signature'->>'gap')::boolean = true)
        from latest
      union all
      -- Frame 5 · Rate limit gap
      select 'rate_limit',
             'No API rate limiting',
             'Auth endpoints left unthrottled · brute-force at full speed',
             ((github_signals->'vibe_concerns'->'rate_limit'->>'needs_attention')::boolean = true)
        from latest
      union all
      -- Frame 6 · Mock data in prod
      select 'mock_data',
             'Mock data in production',
             'Hard-coded seed arrays shipped instead of the real query',
             ((github_signals->'vibe_concerns'->'mock_data'->>'total')::int > 0)
        from latest
      union all
      -- Frame 7 · Hardcoded localhost URLs
      select 'hardcoded_urls',
             'Localhost URLs in code',
             'localhost:3000 / 127.0.0.1 strings shipping to prod',
             ((github_signals->'vibe_concerns'->'hardcoded_urls'->>'total')::int > 0)
        from latest
      union all
      -- Frame 8 · CORS permissive
      select 'cors_permissive',
             'Permissive CORS',
             'origin: * left on · any site can hit your API from the browser',
             ((github_signals->'vibe_concerns'->'cors_permissive'->>'total')::int > 0)
        from latest
      union all
      -- Frame 9 · Observability (inverted · concern = NOT detected)
      select 'observability',
             'No error tracking',
             'Sentry / Datadog / pino not wired · you ship blind',
             ((github_signals->'vibe_concerns'->'observability'->>'detected')::boolean is distinct from true)
        from latest
      union all
      -- Frame 10 · Mobile input zoom
      select 'mobile_input_zoom',
             'iOS Safari input zoom',
             'Tailwind text-sm on inputs · mobile users get a pinch-zoom on focus',
             ((github_signals->'vibe_concerns'->'mobile_input_zoom'->>'needs_attention')::boolean = true)
        from latest
      union all
      -- Frame 11 · Column GRANT mismatch
      select 'column_grant_mismatch',
             'Column-level GRANT mismatch',
             'New columns missing GRANT SELECT · silent 42501 in PostgREST',
             ((github_signals->'vibe_concerns'->'column_grant_mismatch'->>'needs_attention')::boolean = true)
        from latest
      union all
      -- Frame 12 · Stripe API idempotency
      select 'stripe_api_idempotency',
             'Stripe call not idempotent',
             'Outbound Stripe POSTs without Idempotency-Key · double charges on retry',
             ((github_signals->'vibe_concerns'->'stripe_api_idempotency'->>'gap')::boolean = true)
        from latest
      union all
      -- Frame 13 · DB indexes
      select 'db_indexes',
             'Missing DB indexes',
             'FK columns without indexes · queries crawl as the table grows',
             ((github_signals->'vibe_concerns'->'db_indexes'->>'gap_estimate')::int > 0)
        from latest
      union all
      -- Frame 14 · Prompt injection
      select 'prompt_injection',
             'Prompt injection vector',
             'User input piped straight into a model prompt without sanitization',
             ((github_signals->'vibe_concerns'->'prompt_injection'->>'suspicious')::boolean = true)
        from latest
    )
    select f.frame_key,
           f.label,
           f.hint,
           sum(case when f.concerned then 1 else 0 end)::int  as concerned_count,
           total                                              as total_count,
           round(100.0 * sum(case when f.concerned then 1 else 0 end) / total)::int as prevalence_pct
    from frames f
    group by f.frame_key, f.label, f.hint
    order by prevalence_pct desc, f.frame_key;
end$$;

grant execute on function audit_frame_prevalence() to anon, authenticated;
