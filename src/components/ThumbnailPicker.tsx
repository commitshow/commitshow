import { useEffect, useRef, useState } from 'react'
import {
  processThumbnail,
  uploadThumbnail,
  ImageTooLargeError,
  UnsupportedImageError,
  type ProcessedThumbnail,
} from '../lib/imageUpload'
import { useAuth } from '../lib/auth'

interface ThumbnailPickerProps {
  value: { url: string; path: string } | null
  onChange: (v: { url: string; path: string } | null) => void
  required?: boolean
}

export function ThumbnailPicker({ value, onChange, required = false }: ThumbnailPickerProps) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [local, setLocal] = useState<ProcessedThumbnail | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Revoke object URLs on unmount / change so we don't leak.
  useEffect(() => {
    return () => { if (local?.previewUrl) URL.revokeObjectURL(local.previewUrl) }
  }, [local])

  const resetLocal = () => {
    if (local?.previewUrl) URL.revokeObjectURL(local.previewUrl)
    setLocal(null)
  }

  const handleFile = async (file: File) => {
    if (!user?.id) {
      setError('Sign in first to upload a thumbnail.')
      return
    }
    setError('')
    setProcessing(true)
    try {
      const processed = await processThumbnail(file)
      resetLocal()
      setLocal(processed)

      setProcessing(false)
      setUploading(true)
      const uploaded = await uploadThumbnail(processed, user.id)
      onChange({ url: uploaded.publicUrl, path: uploaded.path })
    } catch (e) {
      if (e instanceof ImageTooLargeError || e instanceof UnsupportedImageError) {
        setError(e.message)
      } else {
        setError((e as Error).message || 'Thumbnail processing failed.')
      }
      resetLocal()
      onChange(null)
    } finally {
      setProcessing(false)
      setUploading(false)
    }
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const clear = () => {
    resetLocal()
    onChange(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const busy = processing || uploading
  const displayUrl = local?.previewUrl || value?.url

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={onInputChange}
        className="hidden"
      />

      {displayUrl ? (
        <div className="relative" style={{ border: '1px solid rgba(240,192,64,0.3)', borderRadius: '2px', overflow: 'hidden' }}>
          <img
            src={displayUrl}
            alt="Thumbnail preview"
            className="w-full block"
            style={{ aspectRatio: '3 / 2', objectFit: 'cover', background: 'var(--navy-800)' }}
          />
          <div className="absolute top-2 right-2 flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="font-mono text-xs tracking-wide px-2 py-1"
              style={{ background: 'rgba(6,12,26,0.8)', color: 'var(--cream)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}
            >
              REPLACE
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              className="font-mono text-xs tracking-wide px-2 py-1"
              style={{ background: 'rgba(6,12,26,0.8)', color: 'var(--scarlet)', border: '1px solid rgba(200,16,46,0.35)', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}
            >
              REMOVE
            </button>
          </div>
          {local && (
            <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5 font-mono text-xs" style={{ background: 'rgba(6,12,26,0.85)', color: 'rgba(248,245,238,0.6)' }}>
              {local.width} × {local.height} · {(local.sizeBytes / 1024).toFixed(0)} KB · WebP
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center font-mono text-xs" style={{ background: 'rgba(6,12,26,0.7)', color: 'var(--gold-500)' }}>
              {processing ? 'CONVERTING TO WEBP…' : 'UPLOADING…'}
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className="flex flex-col items-center justify-center text-center py-10 px-5 cursor-pointer transition-colors"
          style={{
            border: `1px dashed ${dragOver ? 'var(--gold-500)' : error ? 'var(--scarlet)' : 'rgba(240,192,64,0.3)'}`,
            background: dragOver ? 'rgba(240,192,64,0.06)' : 'rgba(255,255,255,0.015)',
            borderRadius: '2px',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            {busy ? (processing ? 'CONVERTING TO WEBP…' : 'UPLOADING…') : 'DROP IMAGE OR CLICK TO UPLOAD'}
          </div>
          <div className="font-light text-sm" style={{ color: 'rgba(248,245,238,0.55)', lineHeight: 1.6 }}>
            A hero screenshot or logo. JPG / PNG / WebP / GIF up to 8MB.
            <br />
            <span className="font-mono text-xs" style={{ color: 'rgba(248,245,238,0.35)' }}>
              We resize to max 1200×800 and convert to WebP automatically.
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 pl-3 py-2 pr-3 font-mono text-xs"
          style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
          {error}
        </div>
      )}

      {required && !value && !error && (
        <div className="mt-2 font-mono text-xs" style={{ color: 'rgba(248,245,238,0.35)' }}>
          Required to submit. Thumbnails appear on the project feed and on graduation cards.
        </div>
      )}
    </div>
  )
}
