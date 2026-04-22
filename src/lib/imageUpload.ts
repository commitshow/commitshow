// Client-side image processing + Supabase storage upload.
//
// Two presets share the same pipeline (resize → WebP encode → size-cap retry
// → upload to a user-scoped folder):
//   - Thumbnail (projects): 16:10-ish, 1200×800 max, 512KB cap, .webp
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
  square:     boolean
  quality:    number
}

export const THUMBNAIL_PRESET: ImagePreset = {
  bucket:    'project-thumbnails',
  maxWidth:  1200,
  maxHeight: 800,
  maxBytes:  524_288,   // 512 KB
  square:    false,
  quality:   0.85,
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

  let targetW: number, targetH: number
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight
  if (preset.square) {
    // Center-crop source to a square.
    const side = Math.min(sw, sh)
    sx = Math.round((sw - side) / 2)
    sy = Math.round((sh - side) / 2)
    sw = side; sh = side
    targetW = targetH = Math.min(preset.maxWidth, side)
  } else {
    const r = Math.min(
      preset.maxWidth  / img.naturalWidth,
      preset.maxHeight / img.naturalHeight,
      1,
    )
    targetW = Math.round(img.naturalWidth  * r)
    targetH = Math.round(img.naturalHeight * r)
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable in this browser.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH)

  let quality = preset.quality
  let blob = await canvasToBlob(canvas, 'image/webp', quality)
  while (blob.size > preset.maxBytes && quality > 0.4) {
    quality -= 0.1
    blob = await canvasToBlob(canvas, 'image/webp', quality)
  }
  if (blob.size > preset.maxBytes) {
    throw new ImageTooLargeError(blob.size, preset.maxBytes)
  }
  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: targetW,
    height: targetH,
    sizeBytes: blob.size,
  }
}

export async function uploadImage(processed: ProcessedImage, preset: ImagePreset, userId: string): Promise<{ path: string; publicUrl: string }> {
  const filename = `${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`
  const { error: upErr } = await supabase.storage
    .from(preset.bucket)
    .upload(filename, processed.blob, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
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
