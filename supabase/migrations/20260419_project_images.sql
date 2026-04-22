-- Project images (up to 3 per project).
-- New jsonb `images` column holds [{url, path}, ...] · primary image is [0].
-- A BEFORE trigger mirrors images[0] into the legacy thumbnail_url/_path
-- columns so existing ProjectCard / Grid / FeaturedLane queries keep working
-- untouched.

alter table projects
  add column if not exists images jsonb default '[]'::jsonb;

-- Cap at 3 images · enforced by CHECK
alter table projects drop constraint if exists projects_images_max_check;
alter table projects add constraint projects_images_max_check
  check (jsonb_array_length(coalesce(images, '[]'::jsonb)) <= 3);

-- Backfill: if legacy thumbnail_url exists and images is empty, seed images[0]
-- from the legacy pair.
update projects
   set images = jsonb_build_array(jsonb_build_object('url', thumbnail_url, 'path', thumbnail_path))
 where thumbnail_url is not null
   and jsonb_array_length(coalesce(images, '[]'::jsonb)) = 0;

-- Mirror trigger · keeps thumbnail_url/_path = images[0]
create or replace function sync_project_thumbnail_from_images()
returns trigger as $$
declare
  v_first jsonb;
begin
  if new.images is null or jsonb_array_length(new.images) = 0 then
    new.thumbnail_url  := null;
    new.thumbnail_path := null;
  else
    v_first := new.images -> 0;
    new.thumbnail_url  := v_first ->> 'url';
    new.thumbnail_path := v_first ->> 'path';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_projects_images_sync on projects;
create trigger on_projects_images_sync
  before insert or update of images on projects
  for each row execute function sync_project_thumbnail_from_images();
