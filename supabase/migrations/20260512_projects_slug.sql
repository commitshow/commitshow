-- Slug-based project URLs · spec slug_based_project_urls_v1.
--
-- Adds projects.slug (varchar 50, unique, nullable initially), then
-- backfills existing rows by deriving from project_name with the
-- collision-suffix rule. Column stays nullable for now so audition
-- inserts that haven't been updated client-side yet don't fail —
-- once the client always writes slug at insert we can tighten to
-- NOT NULL.
--
-- Slug rules (matches src/lib/projectSlug.ts):
--   A. Domain-style (regex with dot · tld 2+) → keep as-is, lower
--   B. GitHub URL or owner/repo → owner-repo, slashes→dashes, lower
--   C. Generic name → lower, non-alnum→dash, collapse, trim,
--      ASCII 2-50 chars
--   · non-ASCII names produce NULL · audition flow must reject
--     those at the UI level (or the migration leaves the row
--     slugless and the resolver falls back to UUID).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS slug varchar(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON public.projects (slug);

-- Column-level grants · projects uses the column-grant pattern so
-- new columns need explicit SELECT for anon + authenticated, else
-- they silent-fail with 42501. (recurring memory)
GRANT SELECT (slug) ON public.projects TO anon;
GRANT SELECT (slug) ON public.projects TO authenticated;

-- Reserved slugs that would collide with site routes. Match the
-- TS-side RESERVED_SLUGS set · keep in sync.
DO $$
DECLARE
  reserved_list text[] := ARRAY[
    'admin','api','audit','audition','backstage','community',
    'creators','creator','cli','docs','help','faq','badge',
    'ladder','leaderboard','library','map','me','media','new',
    'pitch','pricing','profile','projects','project','rulebook',
    'scouts','search','settings','signup','login','submit',
    'terms','privacy','tokens','dashboard','about','blog'
  ];
BEGIN
  -- Drop any backfill helper function from prior runs so we can
  -- redefine cleanly.
  DROP FUNCTION IF EXISTS public._slug_derive(text);
END $$;

-- Slug derive function · runs the 3-tier rule. Returns NULL when
-- input can't produce a valid ASCII slug (caller skips that row).
CREATE OR REPLACE FUNCTION public._slug_derive(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  raw_name text := trim(p_name);
  lower_name text;
  candidate  text;
  gh_match   text[];
  reserved_list text[] := ARRAY[
    'admin','api','audit','audition','backstage','community',
    'creators','creator','cli','docs','help','faq','badge',
    'ladder','leaderboard','library','map','me','media','new',
    'pitch','pricing','profile','projects','project','rulebook',
    'scouts','search','settings','signup','login','submit',
    'terms','privacy','tokens','dashboard','about','blog'
  ];
BEGIN
  IF raw_name IS NULL OR raw_name = '' THEN RETURN NULL; END IF;

  lower_name := lower(raw_name);

  -- B. GitHub URL → owner-repo
  gh_match := regexp_match(lower_name, '^(?:https?://)?(?:www\.)?github\.com/([a-z0-9._-]+)/([a-z0-9._-]+?)(?:\.git)?(?:[/?#]|$)');
  IF gh_match IS NOT NULL THEN
    candidate := regexp_replace(gh_match[1] || '-' || gh_match[2], '[^a-z0-9.-]+', '-', 'g');
    candidate := regexp_replace(candidate, '-+', '-', 'g');
    candidate := regexp_replace(candidate, '^[-.]+|[-.]+$', '', 'g');
    candidate := substring(candidate FROM 1 FOR 50);
    IF candidate ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' AND length(candidate) BETWEEN 2 AND 50
       AND NOT (candidate = ANY (reserved_list)) THEN
      RETURN candidate;
    END IF;
  END IF;

  -- A. Domain-style
  IF lower_name ~ '^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$' THEN
    IF lower_name ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' AND length(lower_name) BETWEEN 2 AND 50
       AND NOT (lower_name = ANY (reserved_list)) THEN
      RETURN lower_name;
    END IF;
  END IF;

  -- C. Generic (non-alnum → dash · collapse · trim)
  candidate := regexp_replace(lower_name, '[^a-z0-9.]+', '-', 'g');
  candidate := regexp_replace(candidate, '-+', '-', 'g');
  candidate := regexp_replace(candidate, '^[-.]+|[-.]+$', '', 'g');
  candidate := substring(candidate FROM 1 FOR 50);
  IF candidate ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' AND length(candidate) BETWEEN 2 AND 50
     AND NOT (candidate = ANY (reserved_list)) THEN
    RETURN candidate;
  END IF;

  RETURN NULL;
END $$;

-- Backfill · process rows ordered by created_at so older project
-- claims the base slug, newer one gets the suffix. Skip rows that
-- already have a slug (re-runnable) and rows that don't produce a
-- valid slug (non-ASCII names · resolver falls back to UUID).
DO $$
DECLARE
  r record;
  base_slug   text;
  final_slug  text;
  suffix_n    int;
BEGIN
  FOR r IN
    SELECT id, project_name, github_url, created_at
    FROM projects
    WHERE slug IS NULL
    ORDER BY created_at ASC
  LOOP
    -- Try project_name first, fall back to github_url
    base_slug := public._slug_derive(r.project_name);
    IF base_slug IS NULL AND r.github_url IS NOT NULL THEN
      base_slug := public._slug_derive(r.github_url);
    END IF;

    IF base_slug IS NULL THEN
      CONTINUE;
    END IF;

    -- Collision suffix · -2, -3, ... up to -999
    final_slug := base_slug;
    suffix_n   := 1;
    WHILE EXISTS (SELECT 1 FROM projects WHERE slug = final_slug) LOOP
      suffix_n := suffix_n + 1;
      final_slug := base_slug || '-' || suffix_n::text;
      IF suffix_n > 999 THEN EXIT; END IF;
    END LOOP;

    IF suffix_n <= 999 AND length(final_slug) <= 50 THEN
      UPDATE projects SET slug = final_slug WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- generate_unique_slug RPC · client-side audition flow calls this
-- right before INSERT to claim a slug atomically (collision check
-- inside the function · returns the final slug to use).
CREATE OR REPLACE FUNCTION public.generate_unique_slug(p_name text, p_github_url text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug  text;
  final_slug text;
  suffix_n   int := 1;
BEGIN
  base_slug := _slug_derive(p_name);
  IF base_slug IS NULL AND p_github_url IS NOT NULL THEN
    base_slug := _slug_derive(p_github_url);
  END IF;

  IF base_slug IS NULL THEN
    RETURN NULL;   -- caller must ask user for ASCII alternate
  END IF;

  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM projects WHERE slug = final_slug) LOOP
    suffix_n := suffix_n + 1;
    final_slug := base_slug || '-' || suffix_n::text;
    IF suffix_n > 999 OR length(final_slug) > 50 THEN
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN final_slug;
END $$;

GRANT EXECUTE ON FUNCTION public.generate_unique_slug(text, text) TO authenticated, anon, service_role;

-- ── Auto-populate slug on INSERT when missing ──────────────────────
-- Catches all insert paths (SubmitForm · audit-site-preview Edge
-- Function · CLI · etc) so callers don't have to thread the slug
-- through every code path. Collision suffix is handled inline by
-- looping with -2, -3, ... up to -999.

CREATE OR REPLACE FUNCTION public.projects_auto_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug   text;
  final_slug  text;
  suffix_n    int := 1;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;   -- caller already chose a slug
  END IF;

  base_slug := public._slug_derive(NEW.project_name);
  IF base_slug IS NULL AND NEW.github_url IS NOT NULL THEN
    base_slug := public._slug_derive(NEW.github_url);
  END IF;
  IF base_slug IS NULL AND NEW.live_url IS NOT NULL THEN
    -- URL fast lane · live_url is the only identifier we have.
    -- Strip protocol + trailing slash before deriving.
    base_slug := public._slug_derive(
      regexp_replace(NEW.live_url, '^(?:https?://)?(?:www\.)?', '')
    );
  END IF;

  IF base_slug IS NULL THEN
    -- Non-ASCII name without github_url · leave slug NULL · resolver
    -- falls back to UUID URL until owner renames.
    RETURN NEW;
  END IF;

  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM projects WHERE slug = final_slug) LOOP
    suffix_n := suffix_n + 1;
    final_slug := base_slug || '-' || suffix_n::text;
    IF suffix_n > 999 OR length(final_slug) > 50 THEN
      RETURN NEW;   -- give up · slug stays NULL · resolver still works via UUID
    END IF;
  END LOOP;

  NEW.slug := final_slug;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_projects_auto_slug ON public.projects;
CREATE TRIGGER trg_projects_auto_slug
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.projects_auto_slug();
