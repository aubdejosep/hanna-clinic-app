// Finances ▸ Ledger: receipt photos. Phones' photos are made smaller before uploading; the Photo column shows a
// thumbnail (tap for the big photo) or a camera button to add one.
import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { useToast } from './ui.jsx'

export const photoUrl = (row) => `/api/finances/daily/photos/${row.id}${row.photoV ? `?v=${row.photoV}` : ''}`

// Phone photos are big: make them at most 1600 px and a JPEG before uploading (mobile data).
export async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise((ok) => canvas.toBlob((b) => ok(b || file), 'image/jpeg', 0.8))
  } catch {
    return file
  }
}
export async function uploadPhoto(lineId, file) {
  const blob = await shrink(file)
  const res = await fetch(`/api/finances/daily/photos/${lineId}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' }, credentials: 'same-origin' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The photo didn’t upload. Try again.')
}

export function Lightbox({ row, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Receipt photo" onClick={onClose}>
      <img src={photoUrl(row)} alt={`Receipt ${row.receiptNo || row.receiptQr || ''}`} onClick={(e) => e.stopPropagation()} style={row.photoRotate ? { transform: `rotate(${row.photoRotate}deg)` } : undefined} />
      <button type="button" className="icon-btn rc-lightbox-close" onClick={onClose} aria-label="Close" title="Close"><X /></button>
    </div>
  )
}

export function PhotoCell({ row, tools, onOpen, locked, onUploaded }) {
  const toast = useToast()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  async function pick(file) {
    if (!file) return
    setBusy(true)
    try { await uploadPhoto(row.id, file); row.photo = true; row.photoV = Date.now(); tools.rerender(); toast('Photo saved'); onUploaded?.(row) } catch (err) { toast(err.message) }
    setBusy(false)
  }
  return (
    <span className="rc-photo">
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = '' }} />
      {row.photo
        ? <button type="button" className="rc-thumb" onClick={() => onOpen(row)} title="Open the photo"><img src={photoUrl(row)} alt="" loading="lazy" style={row.photoRotate ? { transform: `rotate(${row.photoRotate}deg)` } : undefined} /></button>
        : <button type="button" className="lg-additem" onClick={() => input.current.click()} disabled={!tools.saved || busy || locked} title={tools.saved ? 'Add the receipt photo' : 'Type the receipt first'} aria-label="Add Photo"><Camera aria-hidden />{busy ? '…' : ''}</button>}
      {row.photo && !locked && <button type="button" className="rc-replace" onClick={() => input.current.click()} disabled={busy} title="Replace the photo" aria-label="Replace Photo"><Camera aria-hidden /></button>}
    </span>
  )
}

