// Draw a signature with a mouse, finger or stylus. Calls onChange(dataUrl) after each stroke,
// or onChange(null) when cleared.
import { useEffect, useRef } from 'react'
import { Eraser } from 'lucide-react'

export default function SignaturePad({ existingUrl, onChange }) {
  const canvas = useRef(null)
  const drawing = useRef(false)
  const drawn = useRef(false)

  useEffect(() => {
    const c = canvas.current
    const ctx = c.getContext('2d')
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#132A6E'
    if (existingUrl) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height)
      img.src = existingUrl
    }
  }, [existingUrl])

  const point = (e) => {
    const r = canvas.current.getBoundingClientRect()
    return [(e.clientX - r.left) * (canvas.current.width / r.width), (e.clientY - r.top) * (canvas.current.height / r.height)]
  }
  const down = (e) => {
    e.preventDefault()
    canvas.current.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvas.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(...point(e))
  }
  const move = (e) => {
    if (!drawing.current) return
    const ctx = canvas.current.getContext('2d')
    ctx.lineTo(...point(e))
    ctx.stroke()
    drawn.current = true
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    if (drawn.current) onChange(canvas.current.toDataURL('image/png'))
  }
  const clear = () => {
    const c = canvas.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    drawn.current = false
    onChange(null)
  }

  return (
    <div className="signature">
      <canvas ref={canvas} width={600} height={180} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        aria-label="Signature box. Draw with a mouse, finger or stylus." role="img" />
      <div className="signature-foot">
        <span className="field-hint">Sign inside the box.</span>
        <button type="button" className="btn btn-quiet" onClick={clear}><Eraser aria-hidden /> Clear</button>
      </div>
    </div>
  )
}
