import { useEffect, useRef, useState } from 'react'
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

export function AvatarPicker({ currentUrl, displayInitial, onUploaded, size = 96 }: AvatarPickerProps) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [local, setLocal] = useState<ProcessedImage | null>(null)

  useEffect(() => () => { if (local?.previewUrl) URL.revokeObjectURL(local.previewUrl) }, [local])

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

  return (
    <div className="flex items-start gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        className="hidden"
      />

      <div
        className="relative flex items-center justify-center font-mono font-bold overflow-hidden"
        style={{
          width: size, height: size,
          background: displayUrl ? 'var(--navy-800)' : 'var(--gold-500)',
          color: 'var(--navy-900)',
          borderRadius: '2px',
          border: '1px solid rgba(240,192,64,0.35)',
          fontSize: size / 3,
          flexShrink: 0,
        }}
      >
        {displayUrl
          ? <img src={displayUrl} alt="Avatar" className="w-full h-full" style={{ objectFit: 'cover' }} />
          : <span>{displayInitial}</span>}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px]" style={{ background: 'rgba(6,12,26,0.7)', color: 'var(--gold-500)' }}>
            UPLOADING…
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="font-mono text-xs tracking-wide px-3 py-2.5"
          style={{
            background: 'transparent',
            border: '1px solid rgba(240,192,64,0.3)',
            color: 'var(--gold-500)',
            borderRadius: '2px',
            cursor: busy ? 'wait' : 'pointer',
            minHeight: 36,
          }}
        >
          {currentUrl ? 'REPLACE AVATAR' : 'UPLOAD AVATAR'}
        </button>
        <div className="font-mono text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          JPG / PNG / WebP — cropped to a 256×256 square, converted to WebP automatically.
        </div>
        {error && (
          <div className="mt-2 pl-2 py-1 pr-2 font-mono text-[10px]"
            style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
