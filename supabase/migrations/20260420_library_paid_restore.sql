-- PRD v1.7: MD Library paid tiers restored (rollback of v1.6 free-only pivot).
-- Aligned with integrated plan doc — paid + free artifacts coexist.
-- Keeps adoption trophy view + feed adoption columns intact (ADDED in v1.6).
-- Safe to re-run (guards everywhere · no destructive drops on re-run).

-- ── 1. Drop the feed view temporarily so columns can be added back ──
drop view if exists md_library_feed;

-- ── 2. Restore columns + generated is_free + constraints ──
alter table md_library
  add column if not exists price_cents        integer default 0,
  add column if not exists platform_fee_pct   numeric(5,2) default 20.00,
  add column if not exists purchase_count     integer default 0,
  add column if not exists revenue_cents      bigint default 0;

-- is_free generated column (was dropped in v1.6)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='md_library' and column_name='is_free'
  ) then
    execute 'alter table md_library add column is_free boolean generated always as (price_cents = 0) stored';
  end if;
end $$;

-- Price check ($0 or ≥ $1)
alter table md_library drop constraint if exists md_library_price_check;
alter table md_library add constraint md_library_price_check
  check (price_cents = 0 or price_cents >= 100);

-- Paid-lookup index
create index if not exists idx_md_library_paid on md_library((price_cents > 0));

-- ── 3. Restore md_purchases table (dropped in v1.6) ──
create table if not exists md_purchases (
  id                  uuid default gen_random_uuid() primary key,
  created_at          timestamptz default now(),
  md_id               uuid references md_library(id) on delete cascade not null,
  buyer_id            uuid references members(id) on delete set null,
  buyer_email         text,
  amount_paid_cents   integer not null check (amount_paid_cents >= 0),
  author_share_cents  integer not null check (author_share_cents >= 0),   -- 80%
  platform_fee_cents  integer not null check (platform_fee_cents >= 0),   -- 20%
  payment_type        text not null check (payment_type in ('card', 'usdc')),
  stripe_session_id   text,
  tx_hash             text,
  refunded_at         timestamptz,
  refund_reason       text
);

alter table md_purchases enable row level security;

drop policy if exists "Buyers can read own purchases" on md_purchases;
create policy "Buyers can read own purchases"
  on md_purchases for select
  using (auth.uid() = buyer_id or
         auth.uid() = (select creator_id from md_library where id = md_purchases.md_id));

drop policy if exists "Service role can manage md_purchases" on md_purchases;
create policy "Service role can manage md_purchases"
  on md_purchases for all
  using (auth.role() = 'service_role');

create index if not exists idx_md_purchases_md    on md_purchases(md_id);
create index if not exists idx_md_purchases_buyer on md_purchases(buyer_id);

-- Post-purchase aggregate sync
create or replace function record_md_purchase_aggregates()
returns trigger as $$
begin
  update md_library
     set purchase_count = purchase_count + 1,
         revenue_cents  = revenue_cents + new.author_share_cents
   where id = new.md_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_md_purchase_insert on md_purchases;
create trigger on_md_purchase_insert
  after insert on md_purchases
  for each row execute function record_md_purchase_aggregates();

-- ── 4. Replace the slim stamping trigger with the full enforce_md_library_rules ──
-- The v1.6 stamp_md_library_badges only handled verified_badge + author_grade.
-- This restored version does both: stamping AND pricing gates (§15.2 v1.7).
drop trigger if exists on_md_library_stamp on md_library;
drop function if exists stamp_md_library_badges() cascade;

create or replace function enforce_md_library_rules()
returns trigger as $$
declare
  v_grade           text;
  v_graduated_count integer;
begin
  select creator_grade, total_graduated
    into v_grade, v_graduated_count
    from members where id = new.creator_id;

  if v_grade is null then
    raise exception 'Creator % not found in members', new.creator_id;
  end if;

  -- A · Rookie cannot sell
  if new.price_cents > 0 and v_grade = 'Rookie' then
    raise exception 'Paid listings require Builder grade or higher (current: %). Publish as free to earn AP.', v_grade;
  end if;

  -- B · Prompt packs must be free (commoditized)
  if new.price_cents > 0 and new.target_format = 'prompt_pack' then
    raise exception 'Prompt packs must be published free — they are commoditized. Publish as $0.';
  end if;

  -- C · Premium tier (> $30 · 2999 cents) needs Maker+
  if new.price_cents > 2999 and v_grade not in ('Maker', 'Architect', 'Vibe Engineer', 'Legend') then
    raise exception 'Premium pricing (> $30) requires Maker grade or higher (current: %)', v_grade;
  end if;

  -- D · Scaffold tier (> $100 · 9999 cents) needs Architect+
  if new.price_cents > 9999 and v_grade not in ('Architect', 'Vibe Engineer', 'Legend') then
    raise exception 'Scaffold pricing (> $100) requires Architect grade or higher (current: %)', v_grade;
  end if;

  -- E · Quality floor — Discovery 4-axis total < 16 cannot be paid
  if new.price_cents > 0
     and coalesce(new.discovery_total_score, 0) < 16 then
    raise exception 'Paid listings require Discovery quality floor (total score >= 16; current: %)',
      coalesce(new.discovery_total_score, 0);
  end if;

  -- F · Auto-stamp verified_badge + author_grade on INSERT (was in slim trigger)
  if tg_op = 'INSERT' then
    new.author_grade   := v_grade;
    new.verified_badge := coalesce(v_graduated_count, 0) > 0;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_md_library_write on md_library;
create trigger on_md_library_write
  before insert or update on md_library
  for each row execute function enforce_md_library_rules();

-- ── 5. Recreate md_library_feed view with BOTH price + adoption columns ──
create view md_library_feed as
  select
    ml.*,
    m.display_name                           as author_name,
    m.email                                  as author_email,
    m.creator_grade                          as current_author_grade,
    m.avatar_url                             as author_avatar_url,
    p.project_name                           as source_project_name,
    p.score_total                            as source_project_score,
    p.status                                 as source_project_status,
    coalesce(ad.projects_applied, 0)         as projects_applied_count,
    coalesce(ad.projects_graduated, 0)       as projects_graduated_count,
    coalesce(ad.total_applications, 0)       as total_applications_count
  from md_library ml
  left join members m             on m.id      = ml.creator_id
  left join projects p            on p.id      = ml.linked_project_id
  left join md_library_adoption ad on ad.md_id = ml.id
  where ml.status = 'published' and ml.is_public = true
  order by
    ml.verified_badge desc,
    ml.is_free desc,
    coalesce(ad.projects_graduated, 0) desc,
    coalesce(ad.projects_applied, 0) desc,
    ml.downloads_count desc,
    ml.created_at desc;
