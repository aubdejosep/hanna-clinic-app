// Finances ▸ Receipts: typing receipts from their photos without clicking back and forth.
//   PhotoViewer     the photo, with zoom (wheel, pinch, buttons), drag to move, and rotate (saved per photo).
//   TypeFromPhotos  one receipt at a time: big photo on the left, a short form on the right; Enter on the last field
//                   saves and opens the next photo. Skip removes a photo that isn't a receipt (its blank row).
//   PhotoPanel      beside the grid on a computer: the photo of the row being typed in, changing as you move.
// Everything saves into staff's own rows (book 'staff'), the same ones the grid shows.
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCw, Scan, SkipForward, Trash2, X } from 'lucide-react'
import { ErrorNote, useToast } from './ui.jsx'
import { api } from '../lib/api.js'

const PAID = [['', '—'], ['cash', 'Cash'], ['gcash', 'GCash'], ['bank', 'Bank Transfer'], ['maribank', 'MariBank'], ['card', 'Card'], ['qrph', 'QRPH'], ['none', 'Not Counted']]
const ONLINE = ['gcash', 'bank', 'maribank', 'card', 'qrph']
export const photoSrc = (line) => `/api/finances/daily/photos/${line.id}${line.photoV ? `?v=${line.photoV}` : ''}`
export const isTyped = (l) => !!(l.receiptNo || l.receiptQr || l.clientName || l.amountCents || l.items?.length)
const peso = (c) => `₱${((c || 0) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
const toCents = (v) => { const t = String(v ?? '').replace(/[₱,\s]/g, ''); if (t === '') return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN }
const toPesos = (c) => (c == null ? '' : String(c / 100))

// What a receipt saves as (the same rule as the grid): Paid With decides Total Income and Online.
export function withMoney(row) {
  if (row.paidWith === 'none') return { ...row, incomeCents: null, onlineCents: null }
  if (row.amountCents == null) return row
  return { ...row, incomeCents: row.amountCents + (row.discountCents || 0), onlineCents: ONLINE.includes(row.paidWith) ? row.amountCents : null }
}

export function PhotoViewer({ line, onRotate, compact }) {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const box = useRef(null)
  const drag = useRef(null)
  const touches = useRef(new Map())
  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }) }, [line?.id])
  if (!line?.photo) return <div className="pv pv-empty"><p>No photo for this receipt.</p></div>
  const rot = line.photoRotate || 0
  const zoomBy = (f) => setView((v) => ({ ...v, zoom: Math.min(6, Math.max(1, v.zoom * f)), ...(v.zoom * f <= 1 ? { x: 0, y: 0 } : {}) }))
  const down = (e) => {
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, view, pinch: touches.current.size === 2 ? dist() : null }
  }
  const dist = () => { const [a, b] = [...touches.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
  const move = (e) => {
    if (!drag.current) return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const d = drag.current
    if (touches.current.size === 2 && d.pinch) { const z = Math.min(6, Math.max(1, d.view.zoom * (dist() / d.pinch))); setView((v) => ({ ...v, zoom: z })); return }
    if (view.zoom > 1) setView({ ...d.view, x: d.view.x + (e.clientX - d.x), y: d.view.y + (e.clientY - d.y) })
  }
  const up = (e) => { touches.current.delete(e.pointerId); if (!touches.current.size) drag.current = null }
  return (
    <div className={`pv ${compact ? 'pv-compact' : ''}`}>
      <div className="pv-stage" ref={box} onMouseDown={(e) => e.preventDefault()} onWheel={(e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15) }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => setView(view.zoom > 1 ? { zoom: 1, x: 0, y: 0 } : { zoom: 2.2, x: 0, y: 0 })}
        style={{ cursor: view.zoom > 1 ? 'grab' : 'zoom-in' }}>
        <img src={photoSrc(line)} alt={`Receipt ${line.receiptNo || line.receiptQr || ''}`} draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom}) rotate(${rot}deg)` }} className={rot % 180 ? 'is-turned' : ''} />
      </div>
      <div className="pv-tools" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.3)} disabled={view.zoom <= 1} aria-label="Zoom out" title="Zoom Out"><Minus /></button>
        <button type="button" className="icon-btn" onClick={() => zoomBy(1.3)} aria-label="Zoom in" title="Zoom In (or scroll, pinch, double-tap)"><Plus /></button>
        <button type="button" className="icon-btn" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} aria-label="Fit" title="Fit the Whole Photo"><Scan /></button>
        {onRotate && <button type="button" className="icon-btn" onClick={() => onRotate((rot + 90) % 360)} aria-label="Rotate" title="Rotate (saved for this photo)"><RotateCw /></button>}
      </div>
    </div>
  )
}

// Save a photo's rotation (the whole row is sent back, as the grid does).
export async function saveRotation(line, rotate) {
  const { items: _i, photo: _p, photoV: _v, ck: _c, staffPhoto: _s, ...body } = line
  await api(`finances/daily/lines/${line.id}`, { method: 'PATCH', body: { ...body, photoRotate: rotate } })
}

function formOf(l) {
  return {
    receiptNo: l.receiptNo || '', receiptQr: l.receiptQr || '', clientName: l.clientName || '', petNames: l.petNames || '',
    amount: toPesos(l.amountCents), discount: toPesos(l.discountCents), paidWith: l.paidWith || '', note: l.note || '',
    items: (l.items || []).map((i) => ({ id: i.id, item: i.item || '', amount: toPesos(i.amountCents) })),
  }
}

export function TypeFromPhotos({ day, lines: initial, startId, onClose }) {
  const toast = useToast()
  const [lines, setLines] = useState(() => initial.filter((l) => l.photo))
  const first = Math.max(0, startId ? lines.findIndex((l) => l.id === startId) : lines.findIndex((l) => !isTyped(l)))
  const [at, setAt] = useState(first)
  const line = lines[at]
  const [f, setF] = useState(() => (line ? formOf(line) : null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [skipAsk, setSkipAsk] = useState(false)
  const firstField = useRef(null)
  const formRef = useRef(null)
  useEffect(() => { if (line) { setF(formOf(line)); setError(null); setSkipAsk(false); requestAnimationFrame(() => firstField.current?.focus()) } }, [line?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  if (!lines.length) {
    return (
      <div className="tfp" role="dialog" aria-modal="true" aria-label="Type From Photos">
        <div className="tfp-empty card card-pad"><p>No photos to type for this day. Use <strong>Upload Photos</strong> first.</p><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </div>
    )
  }
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const setItem = (i, patch) => set({ items: f.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const itemsSum = f.items.reduce((s, x) => s + (toCents(x.amount) || 0), 0)
  const total = toCents(f.amount)
  const disc = toCents(f.discount) || 0
  const sumOff = f.items.length > 0 && total != null && !Number.isNaN(total) && itemsSum - disc !== total
  const num = (f.receiptNo || f.receiptQr).trim()
  const dup = num && lines.some((l) => l.id !== line.id && (l.receiptNo === num || l.receiptQr === num))
  const left = lines.filter((l) => !isTyped(l)).length

  async function save() {
    for (const [k, label] of [['amount', 'Total'], ['discount', 'Discounts']]) if (Number.isNaN(toCents(f[k]))) throw new Error(`Enter ${label} as a number, e.g. 1500.`)
    const items = f.items.filter((x) => x.item.trim() || x.amount !== '')
    if (items.some((x) => Number.isNaN(toCents(x.amount)))) throw new Error('Enter each item’s amount as a number, e.g. 300.')
    const { items: _i, photo: _p, photoV: _v, ...base } = line
    const row = withMoney({ ...base, receiptNo: f.receiptNo.trim(), receiptQr: f.receiptQr.trim(), clientName: f.clientName.trim(), petNames: f.petNames.trim(),
      amountCents: total, discountCents: toCents(f.discount), paidWith: f.paidWith, note: f.note.trim() })
    await api(`finances/daily/lines/${line.id}`, { method: 'PATCH', body: row })
    // Items: change, add, and take out the ones removed.
    const kept = []
    for (const x of items) {
      const body = { lineId: line.id, item: x.item.trim(), amountCents: toCents(x.amount) }
      if (x.id) { await api(`finances/daily/items/${x.id}`, { method: 'PATCH', body }); kept.push({ id: x.id, ...body }) }
      else { const r = await api('finances/daily/items', { method: 'POST', body }); kept.push(r.row) }
    }
    for (const old of line.items || []) if (!items.some((x) => x.id === old.id)) await api(`finances/daily/items/${old.id}`, { method: 'DELETE' })
    const saved = { ...line, ...row, items: kept }
    setLines((ls) => ls.map((l) => (l.id === line.id ? saved : l)))
    return saved
  }
  async function go(to, { saveFirst = true } = {}) {
    setBusy(true); setError(null)
    try {
      if (saveFirst && JSON.stringify(f) !== JSON.stringify(formOf(line))) await save()
      if (to >= lines.length) { toast('All photos done. Check the grid and your summary.'); onClose(); return }
      setAt(Math.max(0, to))
    } catch (err) { setError(err) }
    setBusy(false)
  }
  async function skip() {
    if (isTyped(line) && !skipAsk) { setSkipAsk(true); return }
    setBusy(true)
    try {
      await api(`finances/daily/lines/${line.id}`, { method: 'DELETE' })
      const rest = lines.filter((l) => l.id !== line.id)
      setLines(rest)
      toast('Photo taken out (not a receipt)')
      if (!rest.length) onClose()
      else setAt(Math.min(at, rest.length - 1))
    } catch (err) { setError(err) }
    setBusy(false)
  }
  async function rotate(r) {
    setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, photoRotate: r } : l)))
    try { await saveRotation({ ...line }, r) } catch (err) { toast(err.message) }
  }
  // A new item line, with the cursor in it at once (drawn before the next key press, so nothing typed is lost).
  const addItemLine = () => {
    flushSync(() => set({ items: [...f.items, { item: '', amount: '' }] }))
    formRef.current?.querySelector(`[data-item-name="${f.items.length}"]`)?.focus()
  }
  // Enter: next field; in an item's amount, a new item line; on the last field (Notes), save and next photo.
  const onKey = (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey || e.target.dataset.last) { go(at + 1); return }
    if (e.target.dataset.itemAmount !== undefined) {
      const i = Number(e.target.dataset.itemAmount)
      if (i === f.items.length - 1 && (f.items[i].item || f.items[i].amount)) { addItemLine(); return }
    }
    const fields = [...formRef.current.querySelectorAll('input, select')]
    fields[fields.indexOf(e.target) + 1]?.focus()
  }
  const field = (k, label, props = {}) => (
    <label className="tfp-field"><span>{label}</span><input value={f[k]} onChange={(e) => set({ [k]: e.target.value })} {...props} /></label>
  )
  return (
    <div className="tfp" role="dialog" aria-modal="true" aria-labelledby="tfp-title">
      <div className="tfp-bar">
        <strong id="tfp-title">Type From Photos</strong>
        <span className="tfp-progress"><span style={{ width: `${((lines.length - left) / lines.length) * 100}%` }} /></span>
        <span className="cell-sub">Receipt {at + 1} of {lines.length}{left ? ` · ${left} not typed yet` : ' · all typed'}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)"><X /></button>
      </div>
      <div className="tfp-body">
        <PhotoViewer line={line} onRotate={rotate} />
        <form className="tfp-form" ref={formRef} onKeyDown={onKey} onSubmit={(e) => { e.preventDefault(); go(at + 1) }}>
          <div className="tfp-row">
            {field('receiptQr', 'Receipt No. QR', { ref: firstField, inputMode: 'numeric', placeholder: 'e.g. 05337' })}
            {field('receiptNo', 'Receipt No. OR', { inputMode: 'numeric', placeholder: 'e.g. 02519' })}
          </div>
          {dup && <p className="tfp-warn">Receipt {num} is already used on another photo today.</p>}
          <div className="tfp-row">
            {field('clientName', 'Owner’s Name')}
            {field('petNames', 'Pet’s Name')}
          </div>
          <div className="tfp-items">
            <span className="tfp-label">Items <span className="cell-sub">(Enter in an amount adds the next item)</span></span>
            {f.items.map((x, i) => (
              <div key={i} className="tfp-itemrow">
                <input aria-label={`Item ${i + 1}`} data-item-name={i} value={x.item} onChange={(e) => setItem(i, { item: e.target.value })} placeholder="e.g. Deworm" />
                <input aria-label={`Item ${i + 1} Amount`} data-item-amount={i} className="lg-num" inputMode="decimal" value={x.amount} onChange={(e) => setItem(i, { amount: e.target.value })} placeholder="0" />
                <button type="button" className="icon-btn lg-del" onClick={() => set({ items: f.items.filter((_, j) => j !== i) })} aria-label={`Remove item ${i + 1}`} title="Remove Item"><Trash2 /></button>
              </div>
            ))}
            <button type="button" className="text-btn" onClick={addItemLine}><Plus aria-hidden /> Add Item</button>
          </div>
          <div className="tfp-row">
            <label className="tfp-field"><span>Total Per Receipt</span>
              <input className="lg-num" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder={f.items.length ? toPesos(itemsSum - disc) : '0'} />
              {f.items.length > 0 && !f.amount && itemsSum > 0 && <button type="button" className="text-btn tfp-use" onClick={() => set({ amount: toPesos(itemsSum - disc) })}>Use {peso(itemsSum - disc)}</button>}
            </label>
            {field('discount', 'Discounts', { className: 'lg-num', inputMode: 'decimal', placeholder: '0' })}
          </div>
          {sumOff && <p className="tfp-warn">{disc ? `Items ${peso(itemsSum)} − discount ${peso(disc)} = ${peso(itemsSum - disc)}` : `The items add up to ${peso(itemsSum)}`}, but the total says {peso(total)}.</p>}
          <div className="tfp-row">
            <label className="tfp-field"><span>Paid With</span>
              <select value={f.paidWith} onChange={(e) => set({ paidWith: e.target.value })}>{PAID.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            {field('note', 'Notes', { 'data-last': '1', placeholder: 'Enter saves and opens the next photo' })}
          </div>
          <ErrorNote error={error} />
          <div className="tfp-actions">
            <button type="button" className="btn btn-quiet" onClick={() => go(at - 1)} disabled={busy || at === 0}><ChevronLeft aria-hidden /> Previous</button>
            <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : at === lines.length - 1 ? 'Save and Finish' : 'Save and Next'} {!busy && <ChevronRight aria-hidden />}</button>
            <button type="button" className={`btn btn-quiet ${skipAsk ? 'is-confirm' : ''}`} onClick={skip} disabled={busy} title="For a photo that isn’t a receipt (a ledger page or the summary): takes out its blank row">
              <SkipForward aria-hidden /> {skipAsk ? 'Tap Again: It Has Typing' : 'Not a Receipt'}
            </button>
          </div>
          <p className="field-hint" style={{ margin: 0 }}>Tab or Enter moves to the next box. Enter on Notes (or Ctrl+Enter anywhere) saves and opens the next photo. Esc closes.</p>
        </form>
      </div>
    </div>
  )
}

// Beside the grid on a computer: the photo of the row being typed in.
export function PhotoPanel({ line, onRotate, onClose }) {
  return (
    <aside className="pp card" aria-label="Receipt photo">
      <div className="pp-head">
        <strong>{line ? (line.receiptQr ? `QR ${line.receiptQr}` : line.receiptNo ? `OR ${line.receiptNo}` : 'Not typed yet') : 'Photo'}</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Hide the photo panel" title="Hide Photo Panel"><X /></button>
      </div>
      {line ? <PhotoViewer line={line} onRotate={onRotate} compact /> : <p className="pv-empty-text">Click into a receipt row: its photo shows here.</p>}
    </aside>
  )
}
