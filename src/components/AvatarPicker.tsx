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
  size?: number                 // render size in px · default 128
}

// Avatar control · single click flow:
//   1. Click the tile → info confirm dialog (file format + cropping rules)
//   2. Click Confirm → native file picker opens
//   3. Cancel anytime · dismisses without opening the picker
//
// Camera badge in the corner gives a visual affordance for clickability.
// No separate info icon — the dialog is part of the upload gesture itself.
export function AvatarPicker({ currentUrl, displayInitial, onUploaded, size = 128 }: AvatarPickerProps) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [local,   setLocal]   = useState<ProcessedImage | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => () => { if (local?.previewUrl) URL.revokeObjectURL(local.previewUrl) }, [local])

  // Confirm dialog · Escape closes.
  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirm(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirm])

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
  const openTile  = () => { if (!busy) setConfirm(true) }
  const proceed   = () => { setConfirm(false); inputRef.current?.click() }

  return (
    <div className="inline-block" style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        className="hidden"
      />

      {/* Tile · entire surface triggers the confirm dialog. The img is
          clipped to rounded corners via inner overflow:hidden so the
          camera badge can sit OUTSIDE the tile without being clipped. */}
      <button
        type="button"
        onClick={openTile}
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
          overflow: 'hidden',
        }}
      >
        {displayUrl
          ? <img src={displayUrl} alt="Avatar" className="w-full h-full" style={{ objectFit: 'cover' }} />
          : <span>{displayInitial}</span>}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs" style={{ background: 'rgba(6,12,26,0.7)', color: 'var(--gold-500)' }}>
            UPLOADING…
          </div>
        )}
      </button>

      {/* Camera badge · bottom-right · OUTSIDE the tile so it isn't
          clipped. Pointer-events:none so clicks fall through to tile. */}
      {!busy && (
        <span
          aria-hidden="true"
          className="absolute flex items-center justify-center"
          style={{
            right: -8, bottom: -8,
            width: 28, height: 28,
            background: 'var(--gold-500)',
            color: 'var(--navy-900)',
            borderRadius: '50%',
            border: '2px solid var(--navy-950)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4l2 2H21v14H3V6h4.5l2-2h5z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </span>
      )}

      {confirm && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Avatar upload info"
          onClick={() => setConfirm(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(6,12,26,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 360, width: '100%',
              background: 'var(--navy-800)',
              border: '1px solid rgba(240,192,64,0.35)',
              borderRadius: 3,
              padding: 20,
              color: 'var(--cream)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
              // {currentUrl ? 'REPLACE AVATAR' : 'UPLOAD AVATAR'}
            </div>
            <div className="text-sm mb-3" style={{ color: 'rgba(248,245,238,0.85)', lineHeight: 1.5 }}>
              Pick an image · we crop to a 256×256 square and convert to WebP automatically.
            </div>
            <ul className="font-mono text-[11px] mb-4 pl-4 list-disc" style={{ color: 'rgba(248,245,238,0.6)', lineHeight: 1.6 }}>
              <li>Formats: JPG · PNG · WebP · GIF</li>
              <li>Max 10 MB · larger files rejected client-side</li>
              <li>Stored in our public avatar bucket</li>
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirm(false)}
                className="px-4 py-2 font-mono text-xs tracking-wide"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 2,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={proceed}
                autoFocus
                className="px-4 py-2 font-mono text-xs tracking-wide"
                style={{
                  background: 'var(--gold-500)',
                  color: 'var(--navy-900)',
                  border: 'none',
                  borderRadius: 2,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Pick a file
              </button>
            </div>
          </div>
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
