-- comments.kind · add 'maker_intro' as a third allowed value.
--
-- Purpose: distinguish the launch-post first-comment that the maker
-- publishes via MakerIntroBanner from any other comment they make.
-- The banner used to hide itself the moment a creator posted ANY
-- comment (e.g. a reply on someone else's question), which meant
-- creators who already had unrelated comments — like the maa owner
-- with 2 prior threads — never saw the launch-post draft. Now the
-- banner only hides when a maker_intro comment specifically exists.
--
-- Existing prediction-bot-test sample (id bb32af49-...) gets backfilled
-- to maker_intro so it stays the canonical 'launch post' for that
-- project even though it was inserted as 'human' yesterday.

ALTER TABLE public.comments
  DROP CONSTRAINT IF EXISTS comments_kind_check;

ALTER TABLE public.comments
  ADD CONSTRAINT comments_kind_check
  CHECK (kind IN ('human', 'system', 'maker_intro'));

-- Backfill the manually-inserted Prediction bot test sample so the
-- banner stays hidden there (Chris's launch post is canonical).
UPDATE public.comments
SET kind = 'maker_intro'
WHERE id = 'bb32af49-07c3-4855-bde3-eb24f9573b94';
