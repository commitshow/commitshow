// Client-side image processing + Supabase storage upload.
//
// Two presets share the same pipeline (resize → WebP encode → size-cap retry
// → upload to a user-scoped folder):
//   - Thumbnail (projects): OG / Open Graph 1.91:1, 1200×630 max, 512KB cap, .webp
//                           (matches og:image · X large summary · LinkedIn preview)
//   - Avatar (members):     square 256×256, 256KB cap, .webp
//
// The storage buckets (`project-thumbnails` · `member-avatars`) both enforce
// RLS by first path segment = auth.uid, so uploaded keys are always
// `<uid>/<ts>-<rand>.webp`.

import { supabase } from './supabase'

// ── Presets ────────────────────────────────────────────────────

export interface ImagePreset {
  bucket:     string
  maxWidth:   number
  maxHeight:  number
  maxBytes:   number
  /** When true, center-crop source to a square (avatar). */
  square:     boolean
  /** When set (and square=false), center-crop source to this width/height
   *  ratio so the encoded file matches the social-card / picker preview
   *  exactly. Without this, the pipeline only 'fits' the image inside the
   *  box and the picker's objectFit:cover preview would diverge from the
   *  actual file shape on portrait inputs. */
  aspectRatio?: number
  quality:    number
}

export const THUMBNAIL_PRESET: ImagePreset = {
  bucket:      'project-thumbnails',
  maxWidth:    1200,
  maxHeight:   630,       // OG / Open Graph 1.91:1
  maxBytes:    524_288,   // 512 KB
  square:      false,
  aspectRatio: 1200 / 630,
  quality:     0.85,
}

export const AVATAR_PRESET: ImagePreset = {
  bucket:    'member-avatars',
  maxWidth:  256,
  maxHeight: 256,
  maxBytes:  262_144,   // 256 KB
  square:    true,
  quality:   0.88,
}

// Back-compat re-exports (old callers).
export const THUMBNAIL_BUCKET = THUMBNAIL_PRESET.bucket
export const MAX_UPLOAD_BYTES = THUMBNAIL_PRESET.maxBytes
export const MAX_WIDTH = THUMBNAIL_PRESET.maxWidth
export const MAX_HEIGHT = THUMBNAIL_PRESET.maxHeight
export const WEBP_QUALITY = THUMBNAIL_PRESET.quality

// ── Errors ─────────────────────────────────────────────────────

export class ImageTooLargeError extends Error {
  constructor(bytes: number, capBytes: number) {
    super(`Image is ${Math.round(bytes / 1024)}KB — try a smaller image (final file must be under ${Math.round(capBytes / 1024)}KB).`)
    this.name = 'ImageTooLargeError'
  }
}

export class UnsupportedImageError extends Error {
  constructor(type: string) {
    super(`Unsupported image type: ${type || 'unknown'}. Please use JPG, PNG, or WebP.`)
    this.name = 'UnsupportedImageError'
  }
}

const SUPPORTED_INPUT_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
])

// ── Core pipeline ──────────────────────────────────────────────

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Failed to decode image'))
      img.onload = () => resolve(img)
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas export failed')), mime, quality)
  })
}

export interface ProcessedImage {
  blob: Blob
  previewUrl: string
  width: number
  height: number
  sizeBytes: number
}

export async function processImage(file: File, preset: ImagePreset): Promise<ProcessedImage> {
  if (!SUPPORTED_INPUT_TYPES.has(file.type)) {
    throw new UnsupportedImageError(file.type)
  }
  const img = await loadImage(file)

  // Source-aware starting quality. When the original file already has plenty
  // of headroom under our cap, double-compressing it at 0.85 can actually
  // bloat the output (the WebP encoder treats JPEG compression noise as
  // signal). Starting higher lets the visually-good output stay small; if
  // it's too big anyway, the quality ladder + shrink pass below take over.
  const sourceBytes = file.size
  const cap         = preset.maxBytes
  let startQuality  = preset.quality
  if (sourceBytes <= cap * 0.4)       startQuality = Math.min(0.95, preset.quality + 0.1)
  else if (sourceBytes <= cap * 0.8)  startQuality = Math.min(0.9,  preset.quality + 0.05)

  let targetW: number, targetH: number
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight
  if (preset.square) {
    // Center-crop source to a square.
    const side = Math.min(sw, sh)
    sx = Math.round((sw - side) / 2)
    sy = Math.round((sh - side) / 2)
    sw = side; sh = side
    targetW = targetH = Math.min(preset.maxWidth, side)
  } else if (preset.aspectRatio) {
    // Center-crop source to the preset's aspect ratio so the encoded file
    // matches what the picker preview (objectFit:cover) shows. Then scale
    // to maxWidth × maxHeight while keeping the ratio exact.
    const targetR = preset.aspectRatio
    const srcR    = sw / sh
    if (srcR > targetR) {
      // Source wider than target → trim horizontally.
      const newSw = Math.round(sh * targetR)
      sx = Math.round((sw - newSw) / 2)
      sw = newSw
    } else if (srcR < targetR) {
      // Source taller than target → trim vertically.
      const newSh = Math.round(sw / targetR)
      sy = Math.round((sh - newSh) / 2)
      sh = newSh
    }
    const r = Math.min(preset.maxWidth / sw, preset.maxHeight / sh, 1)
    targetW = Math.round(sw * r)
    targetH = Math.round(sh * r)
  } else {
    // No ratio constraint — preserve aspect, fit inside max box.
    const r = Math.min(
      preset.maxWidth  / img.naturalWidth,
      preset.maxHeight / img.naturalHeight,
      1,
    )
    targetW = Math.round(img.naturalWidth  * r)
    targetH = Math.round(img.naturalHeight * r)
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable in this browser.')

  // Two-pass fit-under-cap pipeline:
  //   pass 1 — encode at preset quality, drop quality in 0.1 steps down to 0.2
  //   pass 2 — if still over the cap, shrink canvas to 75% / 56% / 42% / 32% /
  //            24% of the target dimensions and retry the quality ladder. The
  //            same source crop (sx/sy/sw/sh) is preserved each pass so the
  //            framing doesn't shift; only the destination resolution drops.
  // Most photos clear pass 1 at ≥0.6. Dense screenshots / UI captures with
  // sharp gradients are the ones that survive a 1200×630 box at 0.2 quality
  // and still bust 512KB; pass 2 is the safety net for them.
  const drawAt = (w: number, h: number) => {
    canvas.width = w
    canvas.height = h
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  }

  drawAt(targetW, targetH)
  let quality = startQuality
  let blob = await canvasToBlob(canvas, 'image/webp', quality)

  // Safari < 15 silently returns PNG when asked to encode WebP. PNG of a
  // 1200×630 photo can run 1–2MB, which busts the cap before we even start
  // the quality ladder. Fall back to JPEG (the bucket already accepts both).
  if (blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  }

  while (blob.size > preset.maxBytes && quality > 0.2) {
    quality = Math.max(0.2, quality - 0.1)
    const nextType = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    blob = await canvasToBlob(canvas, nextType, quality)
  }

  let finalW = targetW, finalH = targetH
  const SHRINK_STEPS = [0.75, 0.56, 0.42, 0.32, 0.24]
  for (const scale of SHRINK_STEPS) {
    if (blob.size <= preset.maxBytes) break
    finalW = Math.max(64, Math.round(targetW * scale))
    finalH = Math.max(36, Math.round(targetH * scale))
    drawAt(finalW, finalH)
    quality = 0.75
    const tryType = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    blob = await canvasToBlob(canvas, tryType, quality)
    while (blob.size > preset.maxBytes && quality > 0.2) {
      quality = Math.max(0.2, quality - 0.1)
      blob = await canvasToBlob(canvas, tryType, quality)
    }
  }

  if (blob.size > preset.maxBytes) {
    throw new ImageTooLargeError(blob.size, preset.maxBytes)
  }
  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: finalW,
    height: finalH,
    sizeBytes: blob.size,
  }
}

export async function uploadImage(processed: ProcessedImage, preset: ImagePreset, userId: string): Promise<{ path: string; publicUrl: string }> {
  // Pick extension/contentType from whatever the encoder actually produced.
  // processImage falls back from WebP → JPEG on browsers without WebP canvas
  // support (Safari < 15) so we can't hardcode .webp anymore.
  const mime = processed.blob.type || 'image/webp'
  const ext  = mime === 'image/jpeg' ? 'jpg'
             : mime === 'image/png'  ? 'png'
             :                          'webp'
  const filename = `${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const { error: upErr } = await supabase.storage
    .from(preset.bucket)
    .upload(filename, processed.blob, {
      contentType:  mime,
      cacheControl: '31536000',
      upsert:       false,
    })
  if (upErr) throw new Error(`Image upload failed: ${upErr.message}`)
  const { data } = supabase.storage.from(preset.bucket).getPublicUrl(filename)
  return { path: filename, publicUrl: data.publicUrl }
}

// ── Back-compat wrappers (thumbnail-flow callers unchanged) ────

export type ProcessedThumbnail = ProcessedImage
export const processThumbnail = (file: File) => processImage(file, THUMBNAIL_PRESET)
export const uploadThumbnail = (processed: ProcessedImage, userId: string) => uploadImage(processed, THUMBNAIL_PRESET, userId)

// ── Avatar wrappers ────────────────────────────────────────────

export const processAvatar = (file: File) => processImage(file, AVATAR_PRESET)
export const uploadAvatar  = (processed: ProcessedImage, userId: string) => uploadImage(processed, AVATAR_PRESET, userId)
