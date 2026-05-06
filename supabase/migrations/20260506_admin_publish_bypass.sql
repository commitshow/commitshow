-- Admin bypass for md_library publish gates.
--
-- Background · enforce_md_library_rules currently blocks Rookie creators
-- from publishing paid listings AND auto-stamps verified_badge based on
-- members.total_graduated. Both gates assume a "real" creator with an
-- encored project. commit.show staff (members.is_admin = true) need to
-- be able to seed sample / showcase / dogfooded packs even though their
-- own member rows are typically Rookie + 0 encores.
--
-- Change · early-return after fetching is_admin. Admin author_grade is
-- stamped for transparency (sample listings still show "Rookie" author
-- if that's accurate — no impersonation). verified_badge for admin
-- listings respects an explicit value if provided, OR derives from
-- actual encore evidence (preferred over the legacy total_graduated
-- counter).
--
-- Note · this does NOT make admin listings auto-Verified by default.
-- An admin publishing genuine first-party showcase packs should set
-- verified_badge = true at INSERT time. Otherwise the listing carries
-- no verified mark, which is the right truth for an empty portfolio.

CREATE OR REPLACE FUNCTION public.enforce_md_library_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_grade           text;
  v_graduated_count integer;
  v_encore_count    integer;
  v_is_admin        boolean;
BEGIN
  SELECT creator_grade, total_graduated, COALESCE(is_admin, false)
    INTO v_grade, v_graduated_count, v_is_admin
    FROM members WHERE id = new.creator_id;

  IF v_grade IS NULL THEN
    RAISE EXCEPTION 'Creator % not found in members', new.creator_id;
  END IF;

  -- Admin bypass · staff seeding sample / showcase / dogfooded packs.
  -- Skips grade gates A, B, C, D entirely. Still stamps author_grade
  -- + verified_badge so the listing carries truthful provenance.
  IF v_is_admin THEN
    SELECT COUNT(*) INTO v_encore_count
      FROM public.encores e
      JOIN public.projects p ON p.id = e.project_id
     WHERE p.creator_id = new.creator_id;

    IF tg_op = 'INSERT' THEN
      new.author_grade := v_grade;
      -- Honor explicit verified_badge from the INSERT, else derive
      -- from real encore evidence (with legacy total_graduated as
      -- fallback for projects that pre-date the encores table).
      new.verified_badge := COALESCE(new.verified_badge,
                                     COALESCE(v_encore_count, 0) > 0,
                                     false)
                            OR COALESCE(v_graduated_count, 0) > 0;
    END IF;
    RETURN new;
  END IF;

  -- A · Rookie cannot sell
  IF new.price_cents > 0 AND v_grade = 'Rookie' THEN
    RAISE EXCEPTION 'Paid listings require Builder grade or higher (current: %). Publish free to build reputation.', v_grade;
  END IF;

  -- B · Prompt packs must be free (commoditized)
  IF new.price_cents > 0 AND new.target_format = 'prompt_pack' THEN
    RAISE EXCEPTION 'Prompt packs must be published free — they are commoditized. Set price to $0.';
  END IF;

  -- C · Premium tier (> $30) needs Maker+
  IF new.price_cents > 2999 AND v_grade NOT IN ('Maker', 'Architect', 'Vibe Engineer', 'Legend') THEN
    RAISE EXCEPTION 'Premium pricing (> $30) requires Maker grade or higher (current: %).', v_grade;
  END IF;

  -- D · Scaffold tier (> $100) needs Architect+
  IF new.price_cents > 9999 AND v_grade NOT IN ('Architect', 'Vibe Engineer', 'Legend') THEN
    RAISE EXCEPTION 'Scaffold pricing (> $100) requires Architect grade or higher (current: %).', v_grade;
  END IF;

  -- F · Auto-stamp verified_badge + author_grade on INSERT for
  -- non-admin creators.
  IF tg_op = 'INSERT' THEN
    new.author_grade   := v_grade;
    new.verified_badge := COALESCE(v_graduated_count, 0) > 0;
  END IF;

  RETURN new;
END;
$function$;
