import { useRef, useState } from 'react'
import {
  processThumbnail,
  uploadThumbnail,
  ImageTooLargeError,
  UnsupportedImageError,
} from '../lib/imageUpload'
import { useAuth } from '../lib/auth'
import type { ProjectImage } from '../lib/supabase'

interface Props {
  value: ProjectImage[]              // 0-3 images · [0] is primary
  onChange: (next: ProjectImage[]) => void
  max?: number                       // default 3
  required?: boolean
}

const MAX_IMAGES_DEFAULT = 3

export function ProjectImagesPicker({ value, onChange, max = MAX_IMAGES_DEFAULT, required = false }: Props) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busyIndex, setBusyIndex] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const slotCount = Math.min(max, Math.max(1, (value?.length ?? 0) + 1))
  const slots: Array<ProjectImage | null> = []
  for (let i = 0; i < slotCount; i++) slots.push(value[i] ?? null)

  const handleFileAt = async (slotIndex: number, file: File) => {
    if (!user?.id) { setError('Sign in first to upload images.'); return }
    setError('')
    setBusyIndex(slotIndex)
    try {
      const processed = await processThumbnail(file)
      const uploaded = await uploadThumbnail(processed, user.id)
      const next = value.slice()
      next[slotIndex] = { url: uploaded.publicUrl, path: uploaded.path }
      onChange(next.slice(0, max))
    } catch (e) {
      if (e instanceof ImageTooLargeError || e instanceof UnsupportedImageError) {
        setError(e.message)
      } else {
        setError((e as Error).message || 'Image upload failed.')
      }
    } finally {
      setBusyIndex(null)
    }
  }

  const pickAt = (slotIndex: number) => {
    if (!inputRef.current) return
    inputRef.current.dataset.slot = String(slotIndex)
    inputRef.current.value = ''
    inputRef.current.click()
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    const slot = Number(e.target.dataset.slot ?? '0')
    if (f) handleFileAt(slot, f)
  }

  const removeAt = (slotIndex: number) => {
    const next = value.filter((_, i) => i !== slotIndex)
    onChange(next)
    setError('')
  }

  const makePrimary = (slotIndex: number) => {
    if (slotIndex === 0) return
    const next = value.slice()
    const [picked] = next.splice(slotIndex, 1)
    next.unshift(picked)
    onChange(next)
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={onInputChange}
        className="hidden"
        data-slot="0"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {slots.map((img, i) => (
          <ImageSlot
            key={i}
            index={i}
            img={img}
            busy={busyIndex === i}
            isPrimary={i === 0 && !!img}
            onPick={() => pickAt(i)}
            onRemove={() => removeAt(i)}
            onMakePrimary={() => makePrimary(i)}
            dragOver={dragOver && img == null}
            setDragOver={setDragOver}
            onDropFile={(f) => handleFileAt(i, f)}
            canAddMore={value.length < max}
          />
        ))}
      </div>

      {error && (
        <div className="mt-2 pl-3 py-2 pr-3 font-mono text-xs"
          style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
          {error}
        </div>
      )}

      <div className="mt-2 font-mono text-[11px]" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Recommended size <strong style={{ color: 'var(--cream)' }}>1200 × 630</strong> · OG / Open Graph 1.91:1 ratio
        (same proportion used by feed cards, X large summary, LinkedIn preview).
        Up to <strong style={{ color: 'var(--cream)' }}>{max}</strong> images · JPG / PNG / WebP / GIF up to 8MB each.
        The first image is your <strong style={{ color: 'var(--gold-500)' }}>primary thumbnail</strong>; we resize to
        max 1200×630 and convert to WebP automatically — anything off-ratio gets letterboxed by the cards, so design
        for 1200×630 if you can.
        {required && value.length === 0 && (
          <> · <span style={{ color: 'var(--scarlet)' }}>At least one image is required to audit.</span></>
        )}
      </div>
    </div>
  )
}

function ImageSlot({
  index, img, busy, isPrimary, onPick, onRemove, onMakePrimary, dragOver, setDragOver, onDropFile, canAddMore,
}: {
  index:          number
  img:            ProjectImage | null
  busy:           boolean
  isPrimary:      boolean
  onPick:         () => void
  onRemove:       () => void
  onMakePrimary:  () => void
  dragOver:       boolean
  setDragOver:    (v: boolean) => void
  onDropFile:     (f: File) => void
  canAddMore:     boolean
}) {
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onDropFile(f)
  }

  if (img) {
    return (
      <div className="relative overflow-hidden" style={{
        border: isPrimary ? '1px solid rgba(240,192,64,0.5)' : '1px solid rgba(255,255,255,0.1)',
        borderRadius: '2px',
        boxShadow: isPrimary ? '0 0 14px rgba(240,192,64,0.15)' : undefined,
      }}>
        <img
          src={img.url}
          alt={`Project image ${index + 1}`}
          className="w-full block"
          style={{ aspectRatio: '1200 / 630', objectFit: 'cover', background: 'var(--navy-800)' }}
        />
        {isPrimary && (
          <span className="absolute top-2 left-2 font-mono text-[10px] tracking-widest px-1.5 py-0.5" style={{
            background: 'var(--gold-500)', color: 'var(--navy-900)', borderRadius: '2px',
          }}>
            PRIMARY
          </span>
        )}
        <div className="absolute top-2 right-2 flex gap-1.5">
          {!isPrimary && (
            <button
              type="button"
              onClick={onMakePrimary}
              disabled={busy}
              className="font-mono text-[10px] tracking-wide px-2 py-1"
              style={{ background: 'rgba(6,12,26,0.85)', color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.45)', borderRadius: '2px', cursor: 'pointer' }}
            >
              MAKE PRIMARY
            </button>
          )}
          <button
            type="button"
            onClick={onPick}
            disabled={busy}
            className="font-mono text-[10px] tracking-wide px-2 py-1"
            style={{ background: 'rgba(6,12,26,0.85)', color: 'var(--cream)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}
          >
            REPLACE
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="font-mono text-[10px] tracking-wide px-2 py-1"
            style={{ background: 'rgba(6,12,26,0.85)', color: 'var(--scarlet)', border: '1px solid rgba(200,16,46,0.35)', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}
          >
            ✕
          </button>
        </div>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs" style={{ background: 'rgba(6,12,26,0.7)', color: 'var(--gold-500)' }}>
            UPLOADING…
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={() => !busy && canAddMore && onPick()}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className="flex flex-col items-center justify-center text-center py-8 px-4"
      style={{
        aspectRatio: '1200 / 630',
        border: `1px dashed ${dragOver ? 'var(--gold-500)' : 'rgba(240,192,64,0.3)'}`,
        background: dragOver ? 'rgba(240,192,64,0.06)' : 'rgba(255,255,255,0.015)',
        borderRadius: '2px',
        cursor: busy ? 'wait' : canAddMore ? 'pointer' : 'default',
        opacity: canAddMore ? 1 : 0.5,
      }}
    >
      <div className="font-mono text-[11px] tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
        {busy ? 'UPLOADING…' : index === 0 ? 'ADD PRIMARY' : 'ADD IMAGE'}
      </div>
      <div className="font-mono text-[10px]" style={{ color: 'rgba(248,245,238,0.45)' }}>
        Drop or click
      </div>
    </div>
  )
}
