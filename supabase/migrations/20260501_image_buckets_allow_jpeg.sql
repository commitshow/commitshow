-- ───────────────────────────────────────────────────────────────────────────
-- Image storage buckets · allow JPEG fallback
-- ───────────────────────────────────────────────────────────────────────────
-- The client image pipeline normally encodes WebP, but Safari < 15 silently
-- returns PNG when canvas.toBlob is asked for WebP. Our pipeline now falls
-- back to JPEG in that case (PNG photos blow up to multiple MB and bust
-- the size cap before any retry kicks in).
--
-- Buckets were originally constrained to 'image/webp' only; expand both to
-- ('image/webp', 'image/jpeg') so the fallback uploads succeed. Size limits
-- unchanged (512KB thumbnails · 256KB avatars).
-- ───────────────────────────────────────────────────────────────────────────

update storage.buckets
   set allowed_mime_types = array['image/webp', 'image/jpeg']
 where id in ('project-thumbnails', 'member-avatars');
