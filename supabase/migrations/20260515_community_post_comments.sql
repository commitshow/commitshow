-- Community post comments · 2026-05-15
--
-- The existing `comments` table is hard-bound to projects (project_id NOT
-- NULL FK). Community posts (Build Logs / Stacks / Asks / Office Hours /
-- Open Mic) need their own thread surface · CEO surfaced this when Open
-- Mic shipped without a way to comment on a post.
--
-- Separate table rather than polymorphizing the existing comments table:
--   · existing project-comment queries stay untouched (zero migration risk)
--   · RLS policies stay simple (no `target_type` switch logic)
--   · cascade is straightforward (one FK, one ON DELETE CASCADE)
--
-- Cascade order:
--   · community_posts row delete → community_post_comments rows cascade
--   · members row delete (rare) → author_id set NULL (preserves thread)

create table if not exists community_post_comments (
  id          uuid        default gen_random_uuid() primary key,
  post_id     uuid        references community_posts(id) on delete cascade not null,
  author_id   uuid        references members(id)         on delete set null,
  parent_id   uuid        references community_post_comments(id) on delete cascade,
  body        text        not null check (length(trim(body)) > 0),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_community_post_comments_post
  on community_post_comments(post_id, created_at desc);
create index if not exists idx_community_post_comments_parent
  on community_post_comments(parent_id);
create index if not exists idx_community_post_comments_author
  on community_post_comments(author_id);

alter table community_post_comments enable row level security;

drop policy if exists "Anyone can read community post comments"     on community_post_comments;
drop policy if exists "Auth users author community post comments"   on community_post_comments;
drop policy if exists "Authors edit own community post comments"    on community_post_comments;
drop policy if exists "Authors delete own community post comments"  on community_post_comments;

create policy "Anyone can read community post comments"
  on community_post_comments for select using (true);

create policy "Auth users author community post comments"
  on community_post_comments for insert
  with check (auth.uid() = author_id);

create policy "Authors edit own community post comments"
  on community_post_comments for update
  using (auth.uid() = author_id);

create policy "Authors delete own community post comments"
  on community_post_comments for delete
  using (auth.uid() = author_id);

-- Touch updated_at on UPDATE so the UI can surface "edited Xm ago".
create or replace function touch_community_post_comments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_community_post_comments_updated_at on community_post_comments;
create trigger trg_touch_community_post_comments_updated_at
  before update on community_post_comments
  for each row execute function touch_community_post_comments_updated_at();

grant select on community_post_comments to anon, authenticated;
grant insert, update, delete on community_post_comments to authenticated;
