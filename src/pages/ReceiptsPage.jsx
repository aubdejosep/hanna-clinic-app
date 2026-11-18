// Finances ▸ Receipts (every staff member): the front desk's daily receipts, typed by hand like the paper ledger,
// each with its photo, plus their own summary typed like the paper slip. The rows are the Ledger's own rows (owners
// see the same data in Finances ▸ Ledger). Nothing is read from the photos: they're kept as the record.
//   Receipts: Photo | OR | QR | Owner | Pet | Item | Amount (+ Item for a receipt's items) | Total Per Receipt |
//             Discounts | Paid With | Notes. Paid With fills the Ledger's Total Income and Online Payments.
//   Upload Photos: every photo chosen becomes a new receipt row showing it, ready to type into.
//   Summary: Total Income, Less Expenses, Less Online, (Less 1st Remit), Cash On Hand, and the Online, Expenses
//            and Grooming lists, each checked against the rows ("Receipts add up to …").
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, Camera, CalendarDays, ChevronLeft, ChevronRight, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { ErrorNote, Field, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'
import { summarize } from '../../lib/daily-cash.js'
import { canManage, useStaff } from '../lib/staff.js'
import { GRIDS, Grid, RangeCalendar, peso, shift, today } from './DailyCashPage.jsx'

const PAID = [['', '—'], ['cash', 'Cash'], ['gcash', 'GCash'], ['bank', 'Bank Transfer'], ['maribank', 'MariBank'], ['card', 'Card'], ['qrph', 'QRPH'], ['none', 'Not Counted']]
const ONLINE = ['gcash', 'bank', 'maribank', 'card', 'qrph']
const CODES = [['B', 'B (Bank)'], ['G', 'G (GCash)'], ['MB', 'MB (MariBank)'], ['CC', 'CC (Card)'], ['QR', 'QR (QRPH)'], ['OL', 'OL (Online)']]
const toCents = (v) => { const t = String(v ?? '').replace(/[₱,\s]/g, ''); if (t === '') return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN }
const toPesos = (c) => (c == null ? '' : String(c / 100))
const photoUrl = (row) => `/api/finances/daily/photos/${row.id}${row.photoV ? `?v=${row.photoV}` : ''}`

// Phone photos are big: make them at most 1600 px and a JPEG before uploading (mobile data).
async function shrink(file) {
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
async function uploadPhoto(lineId, file) {
  const blob = await shrink(file)
  const res = await fetch(`/api/finances/daily/photos/${lineId}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' }, credentials: 'same-origin' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The photo didn’t upload. Try again.')
}

// What the Receipts page saves: Paid With decides Total Income (the price before the discount) and Online.
function prepare(row) {
  if (row.paidWith === 'none') return { incomeCents: null, onlineCents: null }
  if (row.amountCents == null) return {}
  return { incomeCents: row.amountCents + (row.discountCents || 0), onlineCents: ONLINE.includes(row.paidWith) ? row.amountCents : null }
}

function Lightbox({ row, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Receipt photo" onClick={onClose}>
      <img src={photoUrl(row)} alt={`Receipt ${row.receiptNo || row.receiptQr || ''}`} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="icon-btn rc-lightbox-close" onClick={onClose} aria-label="Close" title="Close"><X /></button>
    </div>
  )
}

function PhotoCell({ row, tools, onOpen }) {
  const toast = useToast()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  async function pick(file) {
    if (!file) return
    setBusy(true)
    try { await uploadPhoto(row.id, file); row.photo = true; row.photoV = Date.now(); tools.rerender(); toast('Photo saved') } catch (err) { toast(err.message) }
    setBusy(false)
  }
  return (
    <span className="rc-photo">
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = '' }} />
      {row.photo
        ? <button type="button" className="rc-thumb" onClick={() => onOpen(row)} title="Open the photo"><img src={photoUrl(row)} alt="" loading="lazy" /></button>
        : <button type="button" className="lg-additem" onClick={() => input.current.click()} disabled={!tools.saved || busy} title={tools.saved ? 'Add the receipt photo' : 'Type the receipt first'} aria-label="Add Photo"><Camera aria-hidden />{busy ? '…' : ''}</button>}
      {row.photo && <button type="button" className="rc-replace" onClick={() => input.current.click()} disabled={busy} title="Replace the photo" aria-label="Replace Photo"><Camera aria-hidden /></button>}
    </span>
  )
}

// A typed list in the summary (Online, Grooming): name, amount (and code).
function TypedList({ title, rows, setRows, codes, total, check }) {
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="rs-list">
      <h3 className="label">{title}</h3>
      {rows.map((r, i) => (
        <div key={i} className="rs-listrow">
          <input aria-label={`${title}: Name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Name" maxLength={80} />
          <input aria-label={`${title}: Amount`} className="lg-num" inputMode="decimal" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="0" />
          {codes && <select aria-label={`${title}: Paid With`} value={r.code} onChange={(e) => set(i, { code: e.target.value })}><option value="">—</option>{CODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
          <button type="button" className="icon-btn lg-del" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove" title="Remove"><Trash2 /></button>
        </div>
      ))}
      <button type="button" className="text-btn" onClick={() => setRows([...rows, { name: '', amount: '', code: '' }])}><Plus aria-hidden /> Add a Line</button>
      <div className="rs-listtotal"><span>Total</span><strong>{peso(total)}</strong></div>
      {check}
    </div>
  )
}

const Check = ({ typed, rows, label = 'The receipts add up to' }) => {
  if (typed == null || Number.isNaN(typed)) return <span className="rs-check">{label} {peso(rows)}</span>
  return typed === rows ? <span className="rs-check is-ok">✓ Matches the receipts</span> : <span className="rs-check is-off">{label} {peso(rows)} ({typed > rows ? 'over' : 'short'} by {peso(Math.abs(typed - rows))})</span>
}

function Summary({ day, saved, live, onSaved }) {
  const toast = useToast()
  const fromSaved = (s) => ({
    income: toPesos(s?.incomeCents), expenses: toPesos(s?.expensesCents), online: toPesos(s?.onlineCents), firstRemit: toPesos(s?.firstRemitCents), cashOnHand: toPesos(s?.cashOnHandCents), note: s?.note || '',
    onlineList: (s?.onlineList || []).map((x) => ({ name: x.name, amount: toPesos(x.amountCents), code: x.code || '' })),
    groomingList: (s?.groomingList || []).map((x) => ({ name: x.name, amount: toPesos(x.amountCents), code: '' })),
  })
  const [f, setF] = useState(() => fromSaved(saved))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [last, setLast] = useState(saved)
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const c = (k) => toCents(f[k])
  const r = summarize(live)
  const listTotal = (l) => l.reduce((s, x) => s + (toCents(x.amount) || 0), 0)
  const typedCash = [c('income'), c('expenses'), c('online'), c('firstRemit')].some((v) => Number.isNaN(v)) ? null : (c('income') || 0) - (c('expenses') || 0) - (c('online') || 0) - (c('firstRemit') || 0)
  const dirty = JSON.stringify(f) !== JSON.stringify(fromSaved(last))
  async function save() {
    setBusy(true); setError(null)
    try {
      const body = { day, incomeCents: c('income'), expensesCents: c('expenses'), onlineCents: c('online'), firstRemitCents: c('firstRemit'), cashOnHandCents: c('cashOnHand'), note: f.note,
        onlineList: f.onlineList.map((x) => ({ name: x.name, amountCents: toCents(x.amount), code: x.code })), groomingList: f.groomingList.map((x) => ({ name: x.name, amountCents: toCents(x.amount) })) }
      for (const [k, v] of Object.entries(body)) if (Number.isNaN(v)) throw new Error(`Enter ${k.replace(/Cents$/, '')} as a number, e.g. 1500.`)
      const res = await api('finances/daily/summary', { method: 'PUT', body })
      setLast(res.summary); toast('Summary saved'); onSaved?.()
    } catch (err) { setError(err) }
    setBusy(false)
  }
  const money = (k, label, hint) => (
    <Field label={label} optional={k === 'firstRemit'} hint={hint}>{(a) => <input {...a} className="lg-num" inputMode="decimal" value={f[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder="0" />}</Field>
  )
  return (
    <section className="card card-pad rs-card" aria-labelledby="rs-title">
      <div className="rs-head">
        <h2 id="rs-title">Summary</h2>
        <span className="cell-sub">Type it like the paper slip. Each figure is checked against the receipts above.{last?.updatedBy ? ` Last saved by ${last.updatedBy}.` : ''}</span>
      </div>
      <div className="rs-figures">
        <div>{money('income', 'Total Income')}<Check typed={c('income')} rows={r.net} /></div>
        <div>{money('expenses', 'Less Expenses')}<Check typed={c('expenses')} rows={r.expenses} label="The expenses add up to" /></div>
        <div>{money('online', 'Less Online')}<Check typed={c('online')} rows={r.online} /></div>
        <div>{money('firstRemit', 'Less 1st Remit', 'Only if a 1st remit was handed over.')}</div>
        <div className="rs-coh">{money('cashOnHand', 'Cash On Hand')}
          {typedCash != null && c('cashOnHand') != null && !Number.isNaN(c('cashOnHand')) && (c('cashOnHand') === typedCash
            ? <span className="rs-check is-ok">✓ Adds up</span>
            : <span className="rs-check is-off">Income less the figures above is {peso(typedCash)}</span>)}
        </div>
      </div>
      <div className="rs-lists">
        <TypedList title="Online" rows={f.onlineList} setRows={(v) => set({ onlineList: v })} codes total={listTotal(f.onlineList)}
          check={<Check typed={listTotal(f.onlineList)} rows={r.online} label="Online on the receipts:" />} />
        <TypedList title="Grooming" rows={f.groomingList} setRows={(v) => set({ groomingList: v })} total={listTotal(f.groomingList)} />
      </div>
      <Field label="Note" optional>{(a) => <input {...a} value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} placeholder="e.g. 05331 is Lim's balance from Nov 16" />}</Field>
      <ErrorNote error={error} />
      <div className="inline-row">
        <button type="button" className="btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save Summary'}</button>
        {dirty && <span className="field-hint">Not saved yet</span>}
      </div>
    </section>
  )
}

const STAFF_LINES = {
  ...GRIDS.lines,
  minWidth: 1180,
  columns: [
    { key: 'photo', label: 'Photo', type: 'custom', width: '6%' },
    ...GRIDS.lines.columns.filter((c) => ['receiptNo', 'receiptQr', 'clientName', 'petNames', 'item', 'itemAmount', 'amountCents', 'discountCents'].includes(c.key)),
    { key: 'paidWith', label: 'Paid With', type: 'select', options: PAID, width: '9%' },
    { ...GRIDS.lines.columns.find((c) => c.key === 'note'), width: '13%' },
  ],
  blank: (day) => ({ ...GRIDS.lines.blank(day), paidWith: '' }),
}

export default function ReceiptsPage() {
  const toast = useToast()
  const staff = useStaff()
  const [params, setParams] = useSearchParams()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '') ? params.get('day') : today()
  const highlight = Number(params.get('r')) || null
  const go = (d) => setParams(d === today() ? {} : { day: d })
  const [calOpen, setCalOpen] = useState(false)
  const [stamp, setStamp] = useState(0)
  const { data, error } = useApi(`finances/daily?from=${day}&to=${day}${stamp ? `&v=${stamp}` : ''}`)
  const [gen, setGen] = useState(0)
  useEffect(() => { if (data) setGen((g) => g + 1) }, [data])
  const [live, setLive] = useState(null)
  useEffect(() => { if (data) setLive({ lines: data.lines, expenses: data.expenses, remits: data.remits }) }, [data])
  const refreshed = () => api(`finances/daily?from=${day}&to=${day}`).then((d) => setLive({ lines: d.lines, expenses: d.expenses, remits: d.remits })).catch(() => {})
  const [open, setOpen] = useState(null)
  const [upload, setUpload] = useState(null) // {done, total}
  const bulk = useRef(null)
  const ready = data && live && data.from === day
  useEffect(() => { if (ready && highlight) requestAnimationFrame(() => document.getElementById(`receipt-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })) }, [ready, highlight, gen])

  async function uploadMany(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'))
    if (!list.length) return
    setUpload({ done: 0, total: list.length })
    let failed = 0
    for (let i = 0; i < list.length; i++) {
      try {
        const r = await api('finances/daily/lines', { method: 'POST', body: { day } })
        await uploadPhoto(r.row.id, list[i])
      } catch { failed++ }
      setUpload({ done: i + 1, total: list.length })
    }
    setUpload(null)
    setStamp(Date.now())
    toast(failed ? `${list.length - failed} photos added; ${failed} didn’t upload. Add those with the camera button on their row.` : `${list.length} photo${list.length === 1 ? '' : 's'} added: type each receipt next to its photo.`)
  }

  const config = useMemo(() => ({
    ...STAFF_LINES,
    columns: STAFF_LINES.columns.map((c) => (c.key === 'photo' ? { ...c, render: (row, tools) => <PhotoCell row={row} tools={tools} onOpen={setOpen} /> } : c)),
  }), [])
  return (
    <>
      <PageHead crumbs={[{ label: 'Finances' }, { label: 'Receipts' }]} title="Receipts" intro="The day’s receipts with their photos, and your summary. Type each receipt like the paper ledger; each cell saves when you leave it." />
      <div className="lg-bar">
        <button type="button" className="icon-btn" onClick={() => go(shift(day, -1))} aria-label="Previous day" title="Previous Day"><ChevronLeft /></button>
        <div className="rc-wrap">
          <button type="button" className="btn btn-quiet" onClick={() => setCalOpen((o) => !o)} aria-expanded={calOpen}><CalendarDays aria-hidden /> {prettyDay(day)}</button>
          {calOpen && <div className="rc-pop card"><RangeCalendar from={day} to={day} onPick={(a) => { go(a); setCalOpen(false) }} /></div>}
        </div>
        <button type="button" className="icon-btn" onClick={() => go(shift(day, 1))} aria-label="Next day" title="Next Day"><ChevronRight /></button>
        {day !== today() && <button type="button" className="text-btn" onClick={() => go(today())}>Today</button>}
        <input ref={bulk} type="file" accept="image/*" multiple hidden onChange={(e) => { uploadMany(e.target.files); e.target.value = '' }} />
        {canManage(staff) && <Link className="btn btn-quiet" to={`/finances/daily${day === today() ? '' : `?day=${day}`}`} title="Your Ledger for this day: all the money columns, remits and the full summary"><ArrowLeftRight aria-hidden /> Owner Ledger</Link>}
        <button type="button" className="btn" onClick={() => bulk.current.click()} disabled={!!upload || !ready}><ImagePlus aria-hidden /> {upload ? `Uploading ${upload.done} of ${upload.total}…` : 'Upload Photos'}</button>
      </div>
      <ErrorNote error={error} />
      {!ready ? <PawLoader label="Loading the receipts…" /> : (
        <div className="stack" style={{ gap: 16 }}>
          <Grid key={`l-${day}-${gen}`} kind="lines" rows={data.lines} day={day} single onSaved={refreshed} config={config} prepare={prepare} highlight={highlight} />
          <div className="rs-layout">
            <Summary key={`s-${day}-${gen}`} day={day} saved={data.summary} live={live} />
            <Grid key={`e-${day}-${gen}`} kind="expenses" rows={data.expenses} day={day} single onSaved={refreshed} />
          </div>
        </div>
      )}
      {open && <Lightbox row={open} onClose={() => setOpen(null)} />}
    </>
  )
}
