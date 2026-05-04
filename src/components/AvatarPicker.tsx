import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  processAvatar,
  uploadAvatar,
  ImageTooLargeError,
  UnsupportedImageError,
  type ProcessedImage,
} from '../lib/imageUpload'
import { useAuth } from '../lib/auth'

interface AvatarPickerProps {
  currentUrl: string | null
  displayInitial: string
  onUploaded: (url: string) => void | Promise<void>
  size?: number                 // render size in px · default 96
}

// Compact avatar control · the entire tile is the clickable upload target.
// Bottom-right camera badge reinforces 'clickable to change'. Top-right ⓘ
// icon opens a small popover with format details. No separate big UPLOAD
// button or caption — the tile + icons carry the affordance.
export function AvatarPicker({ currentUrl, displayInitial, onUploaded, size = 96 }: AvatarPickerProps) {
  const { user } = useAuth()
  const inputRef  = useRef<HTMLInputElement>(null)
  const infoRef   = useRef<HTMLButtonElement>(null)
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')
  const [local, setLocal] = useState<ProcessedImage | null>(null)
  const [info,  setInfo]  = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => () => { if (local?.previewUrl) URL.revokeObjectURL(local.previewUrl) }, [local])

  // Position the info popover anchored to the ⓘ button (portal renders
  // it at body-level so parent overflow:hidden doesn't clip).
  useEffect(() => {
    if (!info) return
    const r = infoRef.current?.getBoundingClientRect()
    if (r) setCoords({ top: r.bottom + 6, left: r.left })
    const close = (e: MouseEvent) => {
      if (!infoRef.current?.contains(e.target as Node)) setInfo(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setInfo(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown',   esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown',   esc)
    }
  }, [info])

  const handleFile = async (file: File) => {
    if (!user?.id) return
    setError('')
    setBusy(true)
    try {
      const processed = await processAvatar(file)
      if (local?.previewUrl) URL.revokeObjectURL(local.previewUrl)
      setLocal(processed)
      const { publicUrl } = await uploadAvatar(processed, user.id)
      await onUploaded(publicUrl)
    } catch (e) {
      if (e instanceof ImageTooLargeError || e instanceof UnsupportedImageError) setError(e.message)
      else setError((e as Error).message || 'Avatar upload failed.')
    } finally { setBusy(false) }
  }

  const displayUrl = local?.previewUrl || currentUrl
  const click = () => { if (!busy) inputRef.current?.click() }

  return (
    <div className="inline-block" style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        className="hidden"
      />

      {/* Tile · entire surface is the upload click target. The img is
          clipped to rounded corners via inner overflow:hidden so the
          corner badges (camera + info) can sit OUTSIDE the tile without
          being clipped. */}
      <button
        type="button"
        onClick={click}
        disabled={busy}
        aria-label={currentUrl ? 'Replace avatar' : 'Upload avatar'}
        className="relative flex items-center justify-center font-mono font-bold"
        style={{
          width: size, height: size,
          background: displayUrl ? 'var(--navy-800)' : 'var(--gold-500)',
          color: 'var(--navy-900)',
          borderRadius: '2px',
          border: '1px solid rgba(240,192,64,0.35)',
          fontSize: size / 3,
          padding: 0,
          cursor: busy ? 'wait' : 'pointer',
          overflow: 'hidden',           // clips the inner img to the tile
        }}
      >
        {displayUrl
          ? <img src={displayUrl} alt="Avatar" className="w-full h-full" style={{ objectFit: 'cover' }} />
          : <span>{displayInitial}</span>}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[9px]" style={{ background: 'rgba(6,12,26,0.7)', color: 'var(--gold-500)' }}>
            ↑
          </div>
        )}
      </button>

      {/* Camera badge · bottom-right · OUTSIDE the tile button so it
          isn't clipped. Pointer-events:none so clicks pass through to
          the tile underneath (uploading is the same gesture). */}
      {!busy && (
        <span
          aria-hidden="true"
          className="absolute flex items-center justify-center"
          style={{
            right: -6, bottom: -6,
            width: 22, height: 22,
            background: 'var(--gold-500)',
            color: 'var(--navy-900)',
            borderRadius: '50%',
            border: '2px solid var(--navy-950)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4l2 2H21v14H3V6h4.5l2-2h5z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </span>
      )}

      {/* Info ⓘ · top-right · OUTSIDE the tile button so it isn't
          clipped. Click reveals format details via portal popover. */}
      <button
        type="button"
        ref={infoRef}
        onClick={(e) => { e.stopPropagation(); setInfo(o => !o) }}
        aria-label="Avatar upload info"
        aria-expanded={info}
        className="absolute"
        style={{
          top: -6, right: -6,
          width: 20, height: 20,
          background: 'var(--navy-800)',
          color: 'rgba(248,245,238,0.7)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '50%',
          padding: 0,
          fontFamily: '"DM Mono", monospace',
          fontSize: 11,
          fontWeight: 700,
          lineHeight: '18px',
          cursor: 'pointer',
          zIndex: 3,
        }}
      >
        i
      </button>

      {info && coords && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top, left: coords.left,
            zIndex: 1000,
            maxWidth: 240,
            padding: 10,
            background: 'var(--navy-800)',
            border: '1px solid rgba(240,192,64,0.35)',
            borderRadius: 3,
            color: 'rgba(248,245,238,0.85)',
            fontFamily: '"DM Mono", monospace',
            fontSize: 11,
            lineHeight: 1.5,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          }}
        >
          Click the avatar tile to upload. JPG / PNG / WebP, cropped to 256×256, converted to WebP automatically. Max 10 MB.
        </div>,
        document.body,
      )}

      {error && (
        <div className="mt-2 pl-2 py-1 pr-2 font-mono text-[10px]"
          style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)', maxWidth: 240 }}>
          {error}
        </div>
      )}
    </div>
  )
}
