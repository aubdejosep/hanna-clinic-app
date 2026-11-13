// Crop a new clinic logo to a square: drag to move, the slider (or + and −) to zoom, arrow keys to nudge.
// The square guide is exactly what's kept; it's saved as a 512 × 512 PNG (transparent areas stay clear).
import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Panel } from './ui.jsx'

const V = 280 // the square on screen, in px
const OUT = 512

export default function LogoCropper({ file, onClose, onSave, busy }) {
  const [img, setImg] = useState(null)
  const [zoom, setZoom] = useState(1) // 1 = the whole image fits in the square
  const [pos, setPos] = useState({ x: 0, y: 0 }) // the image's centre offset from the square's centre, px
  const drag = useRef(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])
  const fit = img ? V / Math.max(img.naturalWidth, img.naturalHeight) : 1
  const scale = fit * zoom
  const w = img ? img.naturalWidth * scale : 0
  const h = img ? img.naturalHeight * scale : 0
  const setZ = (z) => setZoom(Math.min(4, Math.max(1, Math.round(z * 100) / 100)))
  function onKey(e) {
    const step = e.shiftKey ? 10 : 2
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key]) { e.preventDefault(); setPos((p) => ({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1] })) }
    if (e.key === '+' || e.key === '=') setZ(zoom + 0.1)
    if (e.key === '-') setZ(zoom - 0.1)
  }
  async function save() {
    const c = document.createElement('canvas')
    c.width = OUT
    c.height = OUT
    const k = OUT / V
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, (V / 2 + pos.x - w / 2) * k, (V / 2 + pos.y - h / 2) * k, w * k, h * k)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    onSave(blob)
  }
  return (
    <Panel title="Crop the Logo" intro="Drag the image so the logo sits in the middle of the square. What’s inside the square is what everyone sees." onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy || !img}>{busy ? 'Saving…' : 'Save Logo'}</button></>}>
      <div className="cropper">
        <div className="crop-stage" tabIndex={0} role="application" aria-label="Logo position. Drag, or use the arrow keys; plus and minus to zoom." onKeyDown={onKey}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y } }}
          onPointerMove={(e) => { if (drag.current) setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }) }}
          onPointerUp={() => { drag.current = null }}
          onWheel={(e) => setZ(zoom - Math.sign(e.deltaY) * 0.1)}>
          {img && <img src={img.src} alt="" draggable={false} style={{ width: w, height: h, transform: `translate(${pos.x - w / 2}px, ${pos.y - h / 2}px)` }} />}
          <span className="crop-guide" aria-hidden><i /><i /><i /><i /></span>
        </div>
        <div className="crop-zoom">
          <button type="button" className="icon-btn" onClick={() => setZ(zoom - 0.1)} aria-label="Zoom Out" disabled={zoom <= 1}><Minus /></button>
          <label className="sr-only" htmlFor="crop-zoom">Zoom</label>
          <input id="crop-zoom" type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => setZ(Number(e.target.value))} />
          <button type="button" className="icon-btn" onClick={() => setZ(zoom + 0.1)} aria-label="Zoom In" disabled={zoom >= 4}><Plus /></button>
          <button type="button" className="text-btn" onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }) }}>Center</button>
        </div>
        <div className="crop-previews" aria-label="Preview">
          <span className="cell-sub">Preview</span>
          {[96, 44].map((s) => (
            <span key={s} className="crop-preview" style={{ width: s, height: s }}>
              {img && <img src={img.src} alt="" style={{ width: w * (s / V), height: h * (s / V), transform: `translate(${(pos.x - w / 2) * (s / V)}px, ${(pos.y - h / 2) * (s / V)}px)` }} />}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  )
}
