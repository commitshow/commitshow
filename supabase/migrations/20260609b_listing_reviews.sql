-- Unify ratings + written reviews into one table: a rating is a review with no
-- body; a written review adds body to the same row. Keeps the hero aggregate
-- consistent whether a member quick-rated or wrote a full review.
alter table if exists listing_ratings rename to listing_reviews;
alter table listing_reviews add column if not exists body text;
alter table listing_reviews add column if not exists id uuid default gen_random_uuid();

-- aggregate (name kept; detail page reads this) + review_count
create or replace view listing_rating_stats as
select listing_id,
       round(avg(rating)::numeric, 2)::float as avg_rating,
       count(*)::int as rating_count,
       count(*) filter (where body is not null and length(trim(body)) > 0)::int as review_count
from listing_reviews group by listing_id;
grant select on listing_rating_stats to anon, authenticated;

-- written-reviews feed with author display info (members read via the view owner)
create or replace view listing_reviews_feed as
select r.id, r.listing_id, r.member_id, r.rating, r.body, r.created_at, r.updated_at,
       m.display_name, m.avatar_url
from listing_reviews r join members m on m.id = r.member_id
where r.body is not null and length(trim(r.body)) > 0;
grant select on listing_reviews_feed to anon, authenticated;
