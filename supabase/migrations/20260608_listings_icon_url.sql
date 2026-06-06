-- Separate the square app/service icon from the wide preview image.
-- image_url = wide preview (OG image, App Store screenshot) used on cards/detail.
-- icon_url  = square icon (App Store AppIcon, extension icon, repo avatar) used
--             for the small list/hero thumbnail. A listing can have one, both,
--             or neither (neither → domain favicon → initial).
alter table listings add column if not exists icon_url text;
grant select on listings to anon, authenticated;
