// Finances ▸ Ledger: checking receipts against their photos without clicking back and forth.
//   PhotoViewer  the photo, with zoom (wheel, pinch, buttons), drag to move, and rotate (saved per photo).
//   Review       one receipt at a time: big photo on the left, what the app read (or what was typed) on the right,
//                fields the app was unsure of marked. Approve and Next saves any changes, approves the receipt (staff:
//                Approved by Staff; owners and admins: Approved by Owner) and opens the next one. Not a Receipt
//                removes a photo that isn't one (a ledger page or the summary).
//   TypingHost   keeps Review open across pages (in the Layout): Minimize shrinks it to a small button so staff can
//                search or open an owner or pet, then carry on where they were (unsaved changes kept).
//   PhotoPanel   beside the grid on a computer: the photo of the row being typed in, changing as you move.
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Check, ChevronLeft, ChevronRight, Keyboard, Minimize2, Minus, MoveHorizontal, Plus, RotateCw, Scan, SkipForward, Trash2, X } from 'lucide-react'
import { ErrorNote, useToast } from './ui.jsx'
import { api } from '../lib/api.js'

const PAID = [['', '—'], ['cash', 'Cash'], ['gcash', 'GCash'], ['bank', 'Bank Transfer'], ['maribank', 'MariBank'], ['card', 'Card'], ['qrph', 'QRPH'], ['none', 'Not Counted']]
const ONLINE = ['gcash', 'bank', 'maribank', 'card', 'qrph']
export const photoSrc = (line) => `/api/finances/daily/photos/${line.id}${line.photoV ? `?v=${line.photoV}` : ''}`
const peso = (c) => `₱${((c || 0) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
const toCents = (v) => { const t = String(v ?? '').replace(/[₱,\s]/g, ''); if (t === '') return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN }
const toPesos = (c) => (c == null ? '' : String(c / 100))

// What a receipt saves as (the same rule as the grid): Paid With decides Total Income and Online.
export function withMoney(row) {
  if (row.paidWith === 'none') return { ...row, incomeCents: null, onlineCents: null }
  if (row.amountCents == null) return row
  return { ...row, incomeCents: row.amountCents + (row.discountCents || 0), onlineCents: ONLINE.includes(row.paidWith) ? row.amountCents : null }
}

// The whole photo always fits at first (any rotation): it's measured against the box. Zoom with the buttons, a
// pinch, Ctrl+scroll or a double-click; once zoomed, scroll or drag moves around. Fit Width fills the width and
// starts at the top, for reading a long receipt down to its notes.
export function PhotoViewer({ line, onRotate, compact }) {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [stage, setStage] = useState({ w: 0, h: 0 })
  // The photo's own size, kept with the photo it belongs to: moving to the next receipt never shows the last one's
  // size, and a photo the browser already has (e.g. from the grid's thumbnails) is measured at once, not left hidden.
  const [natOf, setNatOf] = useState(null) // { id, w, h }
  const [failed, setFailed] = useState(null) // id of a photo that didn't load
  const [retry, setRetry] = useState(0)
  const img = useRef(null)
  const nat = natOf && natOf.id === line?.id ? natOf : null
  const measure = (el) => { if (el && el.complete && el.naturalWidth) setNatOf({ id: line?.id, w: el.naturalWidth, h: el.naturalHeight }) }
  const box = useRef(null)
  const drag = useRef(null)
  const touches = useRef(new Map())
  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }); setFailed(null); measure(img.current) }, [line?.id, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!box.current) return undefined
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [line?.photo])
  const rot = line?.photoRotate || 0
  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }) }, [rot])
  if (!line?.photo) return <div className="pv pv-empty"><p>No photo for this receipt.</p></div>
  const turned = rot % 180 !== 0
  // Size of the photo when the whole of it fits (before zoom), and how far it can move once zoomed.
  const ew = nat ? (turned ? nat.h : nat.w) : 1
  const eh = nat ? (turned ? nat.w : nat.h) : 1
  const fit = nat && stage.w ? Math.min(stage.w / ew, stage.h / eh) : 0
  const clamp = (v) => {
    const ox = Math.max(0, (ew * fit * v.zoom - stage.w) / 2)
    const oy = Math.max(0, (eh * fit * v.zoom - stage.h) / 2)
    return { ...v, x: Math.max(-ox, Math.min(ox, v.x)), y: Math.max(-oy, Math.min(oy, v.y)) }
  }
  const zoomBy = (f) => setView((v) => (v.zoom * f <= 1 ? { zoom: 1, x: 0, y: 0 } : clamp({ ...v, zoom: Math.min(8, v.zoom * f) })))
  const fitWidth = () => { if (!fit) return; const z = Math.max(1, stage.w / (ew * fit)); setView(clamp({ zoom: z, x: 0, y: Infinity })) }
  const down = (e) => {
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, view, pinch: touches.current.size === 2 ? dist() : null }
  }
  const dist = () => { const [a, b2] = [...touches.current.values()]; return Math.hypot(a.x - b2.x, a.y - b2.y) }
  const move = (e) => {
    if (!drag.current) return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const d = drag.current
    if (touches.current.size === 2 && d.pinch) { const z = Math.min(8, Math.max(1, d.view.zoom * (dist() / d.pinch))); setView((v) => clamp({ ...v, zoom: z })); return }
    if (view.zoom > 1) setView(clamp({ ...d.view, x: d.view.x + (e.clientX - d.x), y: d.view.y + (e.clientY - d.y) }))
  }
  const up = (e) => { touches.current.delete(e.pointerId); if (!touches.current.size) drag.current = null }
  const wheel = (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey || view.zoom === 1) zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
    else setView((v) => clamp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
  }
  const w = nat ? nat.w * fit : 0
  const h = nat ? nat.h * fit : 0
  return (
    <div className={`pv ${compact ? 'pv-compact' : ''}`}>
      <div className="pv-stage" ref={box} onMouseDown={(e) => e.preventDefault()} onWheel={wheel}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => (view.zoom > 1 ? setView({ zoom: 1, x: 0, y: 0 }) : zoomBy(2.2))}
        style={{ cursor: view.zoom > 1 ? 'grab' : 'zoom-in' }}>
        {failed === line.id && (
          <div className="pv-failed"><p>This photo didn’t load.</p><button type="button" className="btn btn-sm" onClick={() => setRetry((n) => n + 1)}>Try Again</button></div>
        )}
        <img key={`${line.id}-${retry}`} ref={img} src={`${photoSrc(line)}${retry ? `${photoSrc(line).includes('?') ? '&' : '?'}r=${retry}` : ''}`} alt={`Receipt ${line.receiptNo || line.receiptQr || ''}`} draggable={false}
          onLoad={(e) => measure(e.currentTarget)} onError={() => setFailed(line.id)}
          style={nat ? { width: w, height: h, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom}) rotate(${rot}deg)` } : { opacity: 0 }} />
      </div>
      <div className="pv-tools" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.3)} disabled={view.zoom <= 1} aria-label="Zoom out" title="Zoom Out"><Minus /></button>
        <button type="button" className="icon-btn" onClick={() => zoomBy(1.3)} aria-label="Zoom in" title="Zoom In (or Ctrl+scroll, pinch, double-click). Zoomed in, scroll or drag to move around."><Plus /></button>
        <button type="button" className={`btn btn-sm ${view.zoom === 1 ? '' : 'btn-quiet'}`} onClick={() => setView({ zoom: 1, x: 0, y: 0 })} title="See the whole receipt, top to bottom"><Scan aria-hidden /> Full Receipt</button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={fitWidth} title="Fill the width and start at the top; scroll down to the notes"><MoveHorizontal aria-hidden /> Fit Width</button>
        {onRotate && <button type="button" className="icon-btn" onClick={() => onRotate((rot + 90) % 360)} aria-label="Rotate" title="Rotate (saved for this photo)"><RotateCw /></button>}
      </div>
    </div>
  )
}

// Save a photo's rotation (only that field: anyone may turn a photo, even on an approved receipt).
export async function saveRotation(line, rotate) {
  await api(`finances/daily/lines/${line.id}`, { method: 'PATCH', body: { photoRotate: rotate } })
}

// Needs this person's approval: staff approve what the app read; owners and admins approve everything after.
export const needsMe = (l, manager) => (manager ? l.stage !== 'owner' : l.stage === 'draft')
// The app's "unsure" field names -> the form's.
const UNSURE = { receipt_no: ['receiptNo', 'receiptQr'], client: ['clientName'], pet: ['petNames'], items: ['items'], discount: ['discount'], total: ['amount'], paid_hint: ['paidWith'] }
const unsureOf = (l) => new Set(l.stage === 'draft' ? (l.ai?.unclear || []).flatMap((k) => UNSURE[k] || []) : [])

function formOf(l) {
  return {
    receiptNo: l.receiptNo || '', receiptQr: l.receiptQr || '', clientName: l.clientName || '', petNames: l.petNames || '',
    amount: toPesos(l.amountCents), discount: toPesos(l.discountCents), paidWith: l.paidWith || '', note: l.note || '', issueNote: l.issueNote || '',
    ownerNote: l.ownerNote || '', commission: toPesos(l.commissionCents),
    items: (l.items || []).map((i) => ({ id: i.id, item: i.item || '', amount: toPesos(i.amountCents) })),
  }
}
const niceDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// Ask the Layout's TypingHost to open (or bring back) Review; the Ledger page listens for changes.
export const openTyping = (detail) => window.dispatchEvent(new CustomEvent('hanna:type-photos-open', { detail }))
const receiptsChanged = (day) => window.dispatchEvent(new CustomEvent('hanna:receipts-changed', { detail: { day } }))

export function TypingHost() {
  const [session, setSession] = useState(null) // { key, day, lines, startId, manager, minimized, progress }
  useEffect(() => {
    const open = (e) => setSession((s) => (s && s.day === e.detail.day && !e.detail.fresh ? { ...s, minimized: false } : { key: Date.now(), ...e.detail, minimized: false, progress: null }))
    window.addEventListener('hanna:type-photos-open', open)
    return () => window.removeEventListener('hanna:type-photos-open', open)
  }, [])
  if (!session) return null
  const p = session.progress
  return (
    <>
      <Review key={session.key} day={session.day} lines={session.lines} startId={session.startId} manager={!!session.manager} minimized={session.minimized}
        onMinimize={() => { setSession((s) => ({ ...s, minimized: true })); receiptsChanged(session.day) }}
        onProgress={(progress) => setSession((s) => (s ? { ...s, progress } : s))}
        onClose={() => { setSession(null); receiptsChanged(session.day) }} />
      {session.minimized && (
        <button type="button" className="tfp-pill" onClick={() => setSession((s) => ({ ...s, minimized: false }))} title="Back to Review (your place and changes are kept)">
          <Keyboard aria-hidden />
          <span><strong>Review Receipts</strong>{p && <span>Receipt {p.at + 1} of {p.total}{p.left ? ` · ${p.left} to approve` : ''}</span>}</span>
        </button>
      )}
    </>
  )
}

export function Review({ day, lines: initial, startId, manager, onClose, minimized, onMinimize, onProgress }) {
  const toast = useToast()
  const [lines, setLines] = useState(() => initial)
  const first = Math.max(0, startId ? lines.findIndex((l) => l.id === startId) : lines.findIndex((l) => needsMe(l, manager)))
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
    if (minimized) return undefined
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, minimized])
  useEffect(() => { if (!minimized && line) requestAnimationFrame(() => formRef.current?.querySelector('input:focus') || firstField.current?.focus()) }, [minimized]) // eslint-disable-line react-hooks/exhaustive-deps
  const left = lines.filter((l) => needsMe(l, manager)).length
  useEffect(() => { onProgress?.({ at, total: lines.length, left }) }, [at, lines.length, left]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!lines.length || !f) {
    return (
      <div className="tfp" role="dialog" aria-modal="true" aria-label="Review Receipts">
        <div className="tfp-empty card card-pad"><p>No receipts for this day yet. Use <strong>Upload Photos</strong> first.</p><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </div>
    )
  }
  const locked = !manager && line.stage === 'owner'
  const unsure = unsureOf(line)
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const setItem = (i, patch) => set({ items: f.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const itemsSum = f.items.reduce((s, x) => s + (toCents(x.amount) || 0), 0)
  const total = toCents(f.amount)
  const disc = toCents(f.discount) || 0
  const sumOff = f.items.length > 0 && total != null && !Number.isNaN(total) && itemsSum - disc !== total
  const num = (f.receiptNo || f.receiptQr).trim()
  const dup = num && lines.some((l) => l.id !== line.id && (l.receiptNo === num || l.receiptQr === num))
  const elsewhere = (line.dupes || []).filter((d) => d.day !== day)
  const mine = needsMe(line, manager)
  const dirty = JSON.stringify(f) !== JSON.stringify(formOf(line))

  async function save() {
    for (const [k, label] of [['amount', 'Total'], ['discount', 'Discounts'], ['commission', 'Commissions']]) if (Number.isNaN(toCents(f[k]))) throw new Error(`Enter ${label} as a number, e.g. 1500.`)
    const items = f.items.filter((x) => x.item.trim() || x.amount !== '')
    if (items.some((x) => Number.isNaN(toCents(x.amount)))) throw new Error('Enter each item’s amount as a number, e.g. 300.')
    const next = { receiptNo: f.receiptNo.trim(), receiptQr: f.receiptQr.trim(), clientName: f.clientName.trim(), petNames: f.petNames.trim(),
      amountCents: total, discountCents: toCents(f.discount), paidWith: f.paidWith, note: f.note.trim(), issueNote: f.issueNote.trim(),
      ...(manager ? { ownerNote: f.ownerNote.trim(), commissionCents: toCents(f.commission) } : {}) }
    const before = formOf(line)
    // Total Income and Online follow Paid With, only when the total, discount or Paid With changed (an owner's own
    // figures stay otherwise).
    const moneyChanged = before.amount !== f.amount || before.discount !== f.discount || before.paidWith !== f.paidWith
    const full = moneyChanged ? withMoney(next) : next
    const body = {}
    for (const [k, v] of Object.entries(full)) {
      if (k === 'incomeCents' || k === 'onlineCents' ? moneyChanged : (line[k] ?? (k.endsWith('Cents') ? null : '')) !== v) body[k] = v
    }
    let saved = line
    if (Object.keys(body).length) saved = { ...saved, ...(await api(`finances/daily/lines/${line.id}`, { method: 'PATCH', body })).row }
    // Items: change, add, and take out the ones removed.
    if (JSON.stringify(before.items) !== JSON.stringify(f.items)) {
      const kept = []
      for (const x of items) {
        const b = { lineId: line.id, item: x.item.trim(), amountCents: toCents(x.amount) }
        const old = (line.items || []).find((o) => o.id === x.id)
        if (x.id && old && old.item === b.item && old.amountCents === b.amountCents) kept.push(old)
        else if (x.id) { await api(`finances/daily/items/${x.id}`, { method: 'PATCH', body: b }); kept.push({ id: x.id, ...b }) }
        else { const r = await api('finances/daily/items', { method: 'POST', body: b }); kept.push(r.row) }
      }
      for (const old of line.items || []) if (!items.some((x) => x.id === old.id)) await api(`finances/daily/items/${old.id}`, { method: 'DELETE' })
      saved = { ...saved, items: kept }
    }
    setLines((ls) => ls.map((l) => (l.id === line.id ? saved : l)))
    return saved
  }
  async function go(to, { approve = false } = {}) {
    setBusy(true); setError(null)
    try {
      if (!locked && dirty) await save()
      if (approve && mine) {
        const r = await api('finances/daily/approve', { method: 'POST', body: { ids: [line.id] } })
        if (r.approved) setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, stage: r.stage, ...(manager ? { ownerApprovedAt: r.at, ownerApprovedBy: r.by } : { staffApprovedAt: r.at, staffApprovedBy: r.by }) } : l)))
      }
      if (to >= lines.length) { toast(left - (approve && mine ? 1 : 0) > 0 ? 'That was the last receipt. Some are still to approve: they’re marked in the Ledger.' : 'All receipts approved.'); onClose(); return }
      setAt(Math.max(0, to))
    } catch (err) { setError(err) }
    setBusy(false)
  }
  async function skip() {
    if ((line.receiptNo || line.receiptQr || line.clientName || line.amountCents) && !skipAsk) { setSkipAsk(true); return }
    setBusy(true)
    try {
      await api(`finances/daily/lines/${line.id}`, { method: 'DELETE' })
      const rest = lines.filter((l) => l.id !== line.id)
      setLines(rest)
      toast('Taken out (not a receipt)')
      if (!rest.length) onClose()
      else setAt(Math.min(at, rest.length - 1))
    } catch (err) { setError(err) }
    setBusy(false)
  }
  async function rotate(r) {
    setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, photoRotate: r } : l)))
    try { await saveRotation(line, r) } catch (err) { toast(err.message) }
  }
  // A new item line, with the cursor in it at once (drawn before the next key press, so nothing typed is lost).
  const addItemLine = () => {
    flushSync(() => set({ items: [...f.items, { item: '', amount: '' }] }))
    formRef.current?.querySelector(`[data-item-name="${f.items.length}"]`)?.focus()
  }
  // Enter: next field; in an item's amount, a new item line; on the last field, approve and open the next one.
  const onKey = (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey || e.target.dataset.last) { go(at + 1, { approve: true }); return }
    if (e.target.dataset.itemAmount !== undefined) {
      const i = Number(e.target.dataset.itemAmount)
      if (i === f.items.length - 1 && (f.items[i].item || f.items[i].amount)) { addItemLine(); return }
    }
    const fields = [...formRef.current.querySelectorAll('input, select')]
    fields[fields.indexOf(e.target) + 1]?.focus()
  }
  const cls = (k) => `tfp-field${unsure.has(k) ? ' is-unsure' : ''}`
  const tag = (k, label) => <span>{label}{unsure.has(k) && <em className="tfp-unsure"> · check</em>}</span>
  const field = (k, label, props = {}) => (
    <label className={cls(k)}>{tag(k, label)}<input value={f[k]} onChange={(e) => set({ [k]: e.target.value })} {...props} /></label>
  )
  const stageName = { draft: 'Read by App', staff: 'Approved by Staff', owner: 'Approved by Owner' }[line.stage]
  return (
    <div className="tfp" role="dialog" aria-modal="true" aria-labelledby="tfp-title" hidden={minimized}>
      <div className="tfp-bar">
        <strong id="tfp-title">Review Receipts</strong>
        <span className="tfp-progress"><span style={{ width: `${((lines.length - left) / lines.length) * 100}%` }} /></span>
        <span className="cell-sub">Receipt {at + 1} of {lines.length}{left ? ` · ${left} to approve` : ' · all approved'}</span>
        {onMinimize && <button type="button" className="btn btn-quiet btn-sm tfp-min" onClick={onMinimize} title="Shrink to a small button to search or open an owner or pet; your place and changes are kept"><Minimize2 aria-hidden /> Minimize</button>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)"><X /></button>
      </div>
      <div className="tfp-body">
        <PhotoViewer line={line} onRotate={rotate} />
        <form className="tfp-form" ref={formRef} onKeyDown={onKey} onSubmit={(e) => { e.preventDefault(); go(at + 1, { approve: true }) }}>
          <div className="tfp-status">
            <span className={`badge ${line.stage === 'draft' ? 'badge-warn' : line.stage === 'staff' ? 'badge-soft' : ''}`}>{stageName}</span>
            {line.stage !== 'draft' && <span className="cell-sub">{line.stage === 'owner' ? `${line.ownerApprovedBy}` : line.staffApprovedBy}</span>}
          </div>
          {locked && <p className="tfp-note">An owner has approved this receipt, so it can’t be changed here. Ask an owner if something needs fixing.</p>}
          {line.stage === 'draft' && line.ai && !line.ai.error && !line.ai.notReceipt && <p className="tfp-note">Read by the app. Check each number and amount against the photo, then approve.</p>}
          {line.ai?.notReceipt && <p className="tfp-warn">The app thinks this photo isn’t a receipt. If so, tap Not a Receipt.</p>}
          {line.ai?.error && <p className="tfp-warn">The app couldn’t read this photo ({line.ai.error.replace(/\.$/, '')}). Type it in from the photo.</p>}
          {line.ai?.date && line.ai.date !== day && <p className="tfp-warn">The slip is dated {niceDay(line.ai.date)}, not {niceDay(day)}. Check it belongs to this day.</p>}
          <fieldset className="tfp-fields" disabled={locked}>
            <div className="tfp-row">
              {field('receiptQr', 'Receipt No. QR', { ref: firstField, inputMode: 'numeric', placeholder: 'e.g. 05337' })}
              {field('receiptNo', 'Receipt No. OR', { inputMode: 'numeric', placeholder: 'e.g. 02519' })}
            </div>
            {dup && <p className="tfp-warn">Receipt {num} is on another row of this day too.</p>}
            {elsewhere.length > 0 && <p className="tfp-warn">Receipt {num} is also in the Ledger on {elsewhere.map((d) => niceDay(d.day)).join(', ')}.</p>}
            <div className="tfp-row">
              {field('clientName', 'Owner’s Name')}
              {field('petNames', 'Pet’s Name')}
            </div>
            <div className={`tfp-items${unsure.has('items') ? ' is-unsure' : ''}`}>
              <span className="tfp-label">Items{unsure.has('items') && <em className="tfp-unsure"> · check</em>} <span className="cell-sub">(Enter in an amount adds the next item)</span></span>
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
              <label className={cls('amount')}>{tag('amount', 'Total Per Receipt')}
                <input className="lg-num" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder={f.items.length ? toPesos(itemsSum - disc) : '0'} />
                {f.items.length > 0 && !f.amount && itemsSum > 0 && <button type="button" className="text-btn tfp-use" onClick={() => set({ amount: toPesos(itemsSum - disc) })}>Use {peso(itemsSum - disc)}</button>}
              </label>
              {field('discount', 'Discounts', { className: 'lg-num', inputMode: 'decimal', placeholder: '0' })}
            </div>
            {sumOff && <p className="tfp-warn">{disc ? `Items ${peso(itemsSum)} − discount ${peso(disc)} = ${peso(itemsSum - disc)}` : `The items add up to ${peso(itemsSum)}`}, but the total says {peso(total)}.</p>}
            <div className="tfp-row">
              <label className={cls('paidWith')}>{tag('paidWith', 'Paid With')}
                <select value={f.paidWith} onChange={(e) => set({ paidWith: e.target.value })}>{PAID.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              {field('note', 'Notes')}
            </div>
            {manager && (
              <div className="tfp-row">
                {field('commission', 'Commissions', { className: 'lg-num', inputMode: 'decimal', placeholder: '0' })}
                {field('ownerNote', 'Owner Notes', { placeholder: 'Only owners and admins see this' })}
              </div>
            )}
            {field('issueNote', 'To Discuss', { 'data-last': '1', placeholder: 'Something that doesn’t match? Note it to talk about tomorrow' })}
          </fieldset>
          <ErrorNote error={error} />
          <div className="tfp-actions">
            <button type="button" className="btn btn-quiet" onClick={() => go(at - 1)} disabled={busy || at === 0}><ChevronLeft aria-hidden /> Previous</button>
            {mine && !locked
              ? <button type="submit" className="btn" disabled={busy}><Check aria-hidden /> {busy ? 'Saving…' : at === lines.length - 1 ? 'Approve and Finish' : 'Approve and Next'}</button>
              : <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : at === lines.length - 1 ? (dirty ? 'Save and Finish' : 'Finish') : (dirty ? 'Save and Next' : 'Next')} {!busy && <ChevronRight aria-hidden />}</button>}
            {mine && !locked && at < lines.length - 1 && <button type="button" className="btn btn-quiet" onClick={() => go(at + 1)} disabled={busy} title="Save any changes and go on without approving this one">Skip for Now <ChevronRight aria-hidden /></button>}
            {!locked && line.stage !== 'owner' && (
              <button type="button" className={`btn btn-quiet ${skipAsk ? 'is-confirm' : ''}`} onClick={skip} disabled={busy} title="For a photo that isn’t a receipt (a ledger page or the summary): takes out its row">
                <SkipForward aria-hidden /> {skipAsk ? 'Tap Again to Remove' : 'Not a Receipt'}
              </button>
            )}
          </div>
          <p className="field-hint" style={{ margin: 0 }}>Tab or Enter moves to the next box. Enter on To Discuss (or Ctrl+Enter anywhere) approves and opens the next receipt. Esc closes.</p>
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
