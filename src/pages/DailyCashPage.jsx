// Finances ▸ Ledger (owners and admins): the clinic's cash ledger, in the clinic's own sheet layout, typed in like a
// spreadsheet. Receipts: Receipt No. OR | Receipt No. QR | Owner's Name | Pet's Name | Item | Amount | Total Per Receipt |
// Discounts | Notes | Online Payments | Deposit | Balance | Total Income | Commissions, with totals at the bottom. A receipt
// can be split into its items (+ Item): they sit under it with just Item and Amount, and the receipt row checks that
// items − discount = Total Per Receipt. Then Expenses and
// Remits, and the summary: Total Income (before discounts) - Discounts - Online Payments - Expenses - 1st Remit = Cash On Hand, checked against the
// 2nd Remit. The date comes from the calendar (one day, or several by dragging). Each cell saves when you leave it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronDown, ChevronLeft, ArrowLeftRight, Camera, Copy, Scale, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileUp, Plus, Printer, Trash2 } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { EXPENSE_TYPES, summarize } from '../../lib/daily-cash.js'
import LedgerImport from '../components/LedgerImport.jsx'
import { useSuggest } from '../components/ItemSuggest.jsx'
import { mergePetName, useOwnerSuggest, usePetSuggest } from '../components/ClientSuggest.jsx'
import LedgerCompare from '../components/LedgerCompare.jsx'
import { ClearDayButton, ClearedBanner } from '../components/ClearDay.jsx'

export const peso = (c) => `${Number(c || 0) < 0 ? '−' : ''}₱${(Math.abs(Number(c || 0)) / 100).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const toPesos = (c) => (c == null ? '' : String(Math.round(c) / 100))
const toCents = (v) => { const t = String(v ?? '').replace(/[₱,\s]/g, ''); if (t === '') return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN }
export const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
export const shift = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// The three sheets: their columns, what an empty row holds.
export const GRIDS = {
  lines: {
    title: 'Receipts',
    minWidth: 1440,
    columns: [
      { key: 'receiptNo', label: 'Receipt No. OR', width: '6.5%' },
      { key: 'receiptQr', label: 'Receipt No. QR', width: '6.5%' },
      { key: 'clientName', label: 'Owner’s Name', width: '10%' },
      { key: 'petNames', label: 'Pet’s Name', width: '8%' },
      { key: 'item', label: 'Item', width: '13%', item: true },
      { key: 'itemQty', label: 'Qty', type: 'qty', width: '3.5%', item: true },
      { key: 'itemAmount', label: 'Amount', type: 'money', width: '6.5%', item: true },
      { key: 'amountCents', label: 'Total Per Receipt', type: 'money', total: true, width: '7.5%' },
      { key: 'discountCents', label: 'Discounts', type: 'money', total: true, width: '6.5%' },
      { key: 'note', label: 'Notes', width: '9%' },
      { key: 'onlineCents', label: 'Online Payments', type: 'money', total: true, width: '7%' },
      { key: 'depositCents', label: 'Deposit', type: 'money', total: true, width: '6%' },
      { key: 'balanceCents', label: 'Balance', type: 'money', total: true, width: '6%' },
      { key: 'incomeCents', label: 'Total Income', type: 'money', total: true, width: '7%' },
      { key: 'commissionCents', label: 'Commissions', type: 'money', total: true, width: '7%' },
    ],
    blank: (day) => ({ day, receiptNo: '', receiptQr: '', clientName: '', petNames: '', ownerId: null, amountCents: null, discountCents: null, note: '', onlineCents: null, depositCents: null, balanceCents: null, incomeCents: null, commissionCents: null, items: [] }),
  },
  expenses: {
    title: 'Expenses',
    columns: [
      { key: 'category', label: 'Type', type: 'select', options: EXPENSE_TYPES.map((t) => [t, t]), width: 190 },
      { key: 'description', label: 'What For', width: 230 },
      { key: 'amountCents', label: 'Amount', type: 'money', total: true, width: 120 },
    ],
    blank: (day) => ({ day, category: 'Supplies', description: '', amountCents: null }),
  },
  remits: {
    title: 'Remits',
    hint: 'Cash handed over only. Online payments are already taken out.',
    columns: [
      { key: 'kind', label: 'Remit', type: 'select', options: [['first', '1st (3 PM)'], ['second', '2nd (End of Day)']], width: 170 },
      { key: 'amountCents', label: 'Amount', type: 'money', total: true, width: 120 },
      { key: 'remittedBy', label: 'Remitted By', width: 170 },
    ],
    blank: (day) => ({ day, kind: 'first', amountCents: null, remittedBy: '' }),
  },
}
// An empty row only gets saved once something besides its defaults is typed.
const hasContent = (r) => Object.entries(r).some(([k, v]) => !['day', 'category', 'kind', 'id', 'ck', 'items'].includes(k) && v !== '' && v != null)
// Collapse All / Expand All is remembered on this device (the next day opens the same way).
const COLLAPSE_KEY = 'ledger-items-collapsed'
const savedCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }
const rememberCollapsed = (v) => { try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* private window */ } }
// Total Income is the price before the discount, so it should be Total Per Receipt + Discounts.
const incomeOff = (row, col) => col.key === 'incomeCents' && row.incomeCents != null && row.amountCents != null && row.incomeCents !== row.amountCents + (row.discountCents || 0)
const itemSum = (row) => (row.items || []).reduce((n, i) => n + (i.amountCents || 0), 0)

// One calendar: tap a day, or drag across days (mouse or finger) for several.
export function RangeCalendar({ from, to, onPick, book }) {
  const [month, setMonth] = useState(to.slice(0, 7))
  // Days with entries in this record get a dot (book: 'owner' for the Ledger, 'staff' for Receipts).
  const [filled, setFilled] = useState(() => new Set())
  const [sel, setSel] = useState(null) // {a, b} while dragging
  const anchor = useRef(null)
  const first = new Date(`${month}-01T12:00:00Z`)
  const start = shift(`${month}-01`, -((first.getUTCDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => shift(start, i))
  useEffect(() => {
    if (!book) return undefined
    let live = true
    api(`finances/daily/days?from=${days[0]}&to=${days[41]}&book=${book}`).then((r) => { if (live) setFilled(new Set(r.days)) }).catch(() => {})
    return () => { live = false }
  }, [month, book]) // eslint-disable-line react-hooks/exhaustive-deps
  const lo = sel ? (sel.a < sel.b ? sel.a : sel.b) : from
  const hi = sel ? (sel.a < sel.b ? sel.b : sel.a) : to
  const dayAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-day]')?.dataset.day
  const move = (n) => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)) }
  return (
    <div className="rc">
      <div className="rc-head">
        <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="Previous month" title="Previous Month"><ChevronLeft /></button>
        <strong>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>
        <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="Next month" title="Next Month"><ChevronRight /></button>
      </div>
      <div className="rc-grid" role="grid" aria-label="Pick a day, or drag across days"
        onPointerDown={(e) => { const d = dayAt(e); if (!d) return; e.preventDefault(); anchor.current = d; setSel({ a: d, b: d }) }}
        onPointerMove={(e) => { if (!anchor.current) return; const d = dayAt(e); if (d) setSel({ a: anchor.current, b: d }) }}
        onPointerUp={() => { if (!anchor.current || !sel) return; anchor.current = null; const a = sel.a < sel.b ? sel.a : sel.b; const b = sel.a < sel.b ? sel.b : sel.a; setSel(null); onPick(a, b) }}
        onPointerLeave={() => { if (anchor.current && sel) { anchor.current = null; const a = sel.a < sel.b ? sel.a : sel.b; const b = sel.a < sel.b ? sel.b : sel.a; setSel(null); onPick(a, b) } }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <span key={w} className="rc-dow">{w}</span>)}
        {days.map((d) => (
          <button key={d} type="button" data-day={d} role="gridcell" aria-selected={d >= lo && d <= hi}
            className={`rc-day ${d.slice(0, 7) !== month ? 'is-out' : ''} ${d >= lo && d <= hi ? 'is-in' : ''} ${d === lo || d === hi ? 'is-end' : ''} ${d === today() ? 'is-today' : ''} ${filled.has(d) ? 'has-rows' : ''}`} title={filled.has(d) ? 'Has entries' : undefined}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(d, d) } }}>{Number(d.slice(8))}</button>
        ))}
      </div>
      <p className="field-hint" style={{ margin: 0 }}>Tap a day, or drag across days to see several together.{book ? ' A dot marks days with entries.' : ''}</p>
    </div>
  )
}

function Cell({ col, value, onChange, onCommit, r, c, grid, tag, onPick, onPickOwner, onPickPet, ownerId }) {
  const [text, setText] = useState(col.type === 'money' ? toPesos(value) : value ?? '')
  const [focus, setFocus] = useState(false)
  // Suggestions: items from Services/Products, owners and pets from Masterlist.
  const itemSg = useSuggest({ text, active: !!onPick && focus, onPick: (e) => { setText(e.name); onPick(e); onChange(e.name); onCommit({ [col.key]: e.name }) } })
  const ownerSg = useOwnerSuggest({ text, active: !!onPickOwner && focus, onPick: (o) => { setText(o.name); onPickOwner(o) } })
  const petSg = usePetSuggest({ text, active: !!onPickPet && focus, ownerId, onPick: (p) => { const next = mergePetName(text, p.name); setText(next); onPickPet(p, next) } })
  const sg = onPick ? itemSg : onPickOwner ? ownerSg : onPickPet ? petSg : null
  useEffect(() => { if (!focus) setText(col.type === 'money' ? toPesos(value) : value ?? '') }, [value, focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const nav = (e) => {
    const move = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!move || (col.type === 'select' && e.key !== 'Enter')) return
    e.preventDefault()
    e.currentTarget.blur()
    // The next row that has this column (item rows only have Item and Amount; receipt rows don't edit those).
    requestAnimationFrame(() => {
      for (let n = r + move, i = 0; i < 80 && n >= 0; n += move, i++) {
        const el = document.querySelector(`[data-grid="${grid}"][data-r="${n}"][data-c="${c}"]`)
        if (el) { el.focus(); return }
      }
    })
  }
  const common = { 'data-grid': grid, 'data-r': r, 'data-c': c, 'data-tag': tag, 'aria-label': col.label, onKeyDown: (e) => { if (!sg?.keys(e)) nav(e) }, onFocus: () => setFocus(true) }
  if (col.type === 'select') {
    return <select {...common} className="lg-cell" value={value} onChange={(e) => { onChange(e.target.value); onCommit({ [col.key]: e.target.value }) }} onBlur={() => setFocus(false)}>{col.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
  }
  if (col.type === 'date') {
    return <input {...common} type="date" className="lg-cell" value={value || ''} onChange={(e) => e.target.value && onChange(e.target.value)} onBlur={(e) => { setFocus(false); onCommit({ day: e.target.value || value }) }} />
  }
  if (col.type === 'qty') {
    return <input {...common} className="lg-cell lg-num" inputMode="decimal" value={String(text)} onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ''))} onFocus={(e) => { setFocus(true); e.target.select() }}
      onBlur={() => { setFocus(false); const v = Number(text) > 0 ? Number(text) : 1; setText(String(v)); if (v !== Number(value)) { onChange(v); onCommit({ [col.key]: v }) } }} />
  }
  return (
    <>
    <input {...common} ref={sg?.anchor} autoComplete="off" className={`lg-cell ${col.type === 'money' ? 'lg-num' : ''}`} inputMode={col.type === 'money' ? 'decimal' : undefined} value={focus || col.type !== 'money' ? text : text === '' ? '' : (toCents(text) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}
      onChange={(e) => setText(e.target.value)} maxLength={col.type === 'money' ? 14 : 300}
      onBlur={() => {
        setFocus(false)
        const v = col.type === 'money' ? toCents(text) : text.trim()
        if (Number.isNaN(v)) { setText(toPesos(value)); return }
        if (v !== (value ?? (col.type === 'money' ? null : ''))) { onChange(v); onCommit({ [col.key]: v }) }
      }} />
    {sg?.popup}
    </>
  )
}

// One sheet. Rows live in a ref (the latest values, changed the moment a cell changes) and keep the same on-screen
// key from the first keystroke, so a row being saved for the first time is never redrawn (nothing half-typed is
// lost). Saves run one after another and always send the row as it is now. With several days picked, rows are
// grouped under their date and there's no empty row (rows are added on a single day).
let nextKey = 1
const withKey = (r) => ({ ...r, ck: `k${nextKey++}` })
// config: the columns (default GRIDS[kind]); prepare(row) adjusts what is saved (the Receipts page works out
// Total Income and Online from Paid With); custom columns ({type: 'custom', render(row, api)}) draw their own cell.
export function Grid({ kind, rows, day, single, onSaved, config, prepare, highlight }) {
  const g = config || GRIDS[kind]
  const toast = useToast()
  const store = useRef(null)
  const [, redraw] = useState(0)
  const [confirm, setConfirm] = useState(null)
  const saving = useRef(Promise.resolve())
  const [shut, setShut] = useState(() => (savedCollapsed() ? new Set(rows.map((r) => r.id)) : new Set())) // receipts with items hidden
  const isShut = (row) => row.id && shut.has(row.id)
  const toggle = (row) => setShut((s) => { const t = new Set(s); if (t.has(row.id)) t.delete(row.id); else t.add(row.id); return t })
  function setAll(collapse, onDay) {
    const ids = store.current.filter((r) => r.id && r.items?.length && (!onDay || r.day === onDay)).map((r) => r.id)
    setShut((s) => { const t = new Set(s); ids.forEach((id) => (collapse ? t.add(id) : t.delete(id))); return t })
    if (!onDay) rememberCollapsed(collapse)
  }
  const keyed = (r) => withKey(kind === 'lines' ? { ...r, items: (r.items || []).map(withKey) } : r)
  if (!store.current) store.current = [...rows.map(keyed), ...(single ? [keyed(g.blank(day))] : [])]
  const rerender = () => redraw((n) => n + 1)
  const find = (ck) => store.current.find((x) => x.ck === ck)
  const findItem = (row, ick) => row?.items?.find((x) => x.ck === ick)
  function set(ck, k, v) { const row = find(ck); if (row) { row[k] = v; rerender() } }
  function patchRow(ck, patch) { const row = find(ck); if (row) { Object.assign(row, patch); rerender() } }
  function setItem(ck, ick, k, v) { const it = findItem(find(ck), ick); if (it) { it[k] = v; rerender() } }
  const queue = (job) => { saving.current = saving.current.then(job) }
  function save(ck) {
    queue(async () => {
      const row = find(ck)
      if (!row) return
      if (prepare) Object.assign(row, prepare(row))
      const { ck: _ck, items: _items, photo: _photo, photoRotate: _rot, photoV: _v, staffPhoto: _sp, ...body } = row
      try {
        if (row.id) await api(`finances/daily/${kind}/${row.id}`, { method: 'PATCH', body })
        else {
          if (!hasContent(row)) return
          const r = await api(`finances/daily/${kind}`, { method: 'POST', body })
          row.id = r.row.id
          if (store.current[store.current.length - 1].ck === ck) store.current.push(keyed(g.blank(row.day)))
          rerender()
        }
        onSaved()
      } catch (err) { toast(err.message) }
    })
  }
  function saveItem(ck, ick) {
    queue(async () => {
      const row = find(ck)
      const it = findItem(row, ick)
      if (!row?.id || !it) return
      const body = { lineId: row.id, item: it.item, amountCents: it.amountCents, ...(it.qty != null ? { qty: it.qty, unitCents: it.unitCents ?? (it.amountCents != null ? Math.round(it.amountCents / it.qty) : null) } : {}) }
      try {
        if (it.id) await api(`finances/daily/items/${it.id}`, { method: 'PATCH', body })
        else if (it.item || it.amountCents != null) { it.id = (await api('finances/daily/items', { method: 'POST', body })).row.id; rerender() }
      } catch (err) { toast(err.message) }
    })
  }
  function addItem(row) {
    const it = withKey({ item: '', amountCents: null })
    row.items = [...(row.items || []), it]
    setShut((s) => { const t = new Set(s); t.delete(row.id); return t })
    rerender()
    requestAnimationFrame(() => document.querySelector(`[data-tag="${it.ck}"]`)?.focus())
  }
  async function remove(row) {
    if (confirm !== row.ck) { setConfirm(row.ck); setTimeout(() => setConfirm((c) => (c === row.ck ? null : c)), 3000); return }
    try {
      await api(`finances/daily/${kind}/${row.id}`, { method: 'DELETE' })
      store.current = store.current.filter((x) => x.ck !== row.ck)
      setConfirm(null); rerender(); onSaved(); toast('Row removed')
    } catch (err) { toast(err.message) }
  }
  async function removeItem(row, it) {
    if (confirm !== it.ck) { setConfirm(it.ck); setTimeout(() => setConfirm((c) => (c === it.ck ? null : c)), 3000); return }
    try {
      if (it.id) await api(`finances/daily/items/${it.id}`, { method: 'DELETE' })
      row.items = row.items.filter((x) => x.ck !== it.ck)
      setConfirm(null); rerender()
    } catch (err) { toast(err.message) }
  }
  const all = store.current
  const saved = all.filter((r) => r.id)
  const totals = Object.fromEntries(g.columns.filter((c) => c.total).map((c) => [c.key, all.reduce((sum, r) => sum + (r[c.key] || 0), 0)]))
  const span = g.columns.length + 2
  let lastDay = null
  let n = 0
  let vr = 0 // on-screen row number, for moving between cells with Enter and the arrows
  const anyItems = (onDay) => all.some((r) => r.items?.length && (!onDay || r.day === onDay))
  const allBtns = (onDay) => anyItems(onDay) && (
    <span className="lg-allbtns">
      <button type="button" className="text-btn" onClick={() => setAll(false, onDay)}><ChevronsUpDown aria-hidden /> Expand All</button>
      <button type="button" className="text-btn" onClick={() => setAll(true, onDay)}><ChevronsDownUp aria-hidden /> Collapse All</button>
    </span>
  )
  const delBtn = (key, label, onClick) => (
    <button type="button" className={`icon-btn lg-del ${confirm === key ? 'is-confirm' : ''}`} onClick={onClick} aria-label={confirm === key ? `Tap again to remove this ${label}` : `Remove ${label}`} title={confirm === key ? 'Tap again to remove' : `Remove ${label}`}>{confirm === key ? '?' : <Trash2 />}</button>
  )
  function receiptCell(row, col) {
    if (col.key === 'item') {
      const count = row.items?.length || 0
      const Chev = isShut(row) ? ChevronRight : ChevronDown
      return (
        <span className="lg-itemtools">
          {row.staffPhoto && <a className="lg-staffphoto" href={`/api/finances/daily/photos/${row.staffPhoto}`} target="_blank" rel="noreferrer" title="Open staff’s photo of this receipt" aria-label="Open staff’s photo"><Camera aria-hidden /></a>}
          {count > 0 && <button type="button" className="lg-toggle" onClick={() => toggle(row)} aria-expanded={!isShut(row)} title={isShut(row) ? 'Show the items' : 'Hide the items'}><Chev aria-hidden /> {count} Item{count === 1 ? '' : 's'}</button>}
          <button type="button" className="lg-additem" onClick={() => addItem(row)} disabled={!row.id} title={row.id ? 'Add an item to this receipt' : 'Type the receipt first'} aria-label="Add Item"><Plus aria-hidden />{count ? '' : ' Item'}</button>
        </span>
      )
    }
    if (!row.items?.length || col.key === 'itemQty') return null
    const sum = itemSum(row)
    const due = sum - (row.discountCents || 0) - (row.balanceCents || 0)
    const ok = !row.amountCents || due === row.amountCents
    return <span className={`lg-sum ${ok ? '' : 'is-off'}`} title={`Items ${peso(sum)}${row.discountCents ? ` − discount ${peso(row.discountCents)}` : ''}${row.balanceCents ? ` − balance ${peso(row.balanceCents)}` : ''}${row.discountCents || row.balanceCents ? ` = ${peso(due)}` : ''}${ok ? '' : `; Total Per Receipt is ${peso(row.amountCents)}`}`}>{ok ? '' : '≠ '}{peso(sum)}</span>
  }
  return (
    <section className="card lg-card">
      <div className="card-head"><h2>{g.title}</h2>{kind === 'lines' && allBtns()}<span className="cell-sub">{g.hint ? `${g.hint} ` : ''}{saved.length} row{saved.length === 1 ? '' : 's'}{single ? ' · type in the last row to add one' : ' · pick one day to add rows'}{kind === 'lines' ? ' · + Item splits a receipt into its items' : ''}</span></div>
      <div className="lg-scroll">
        <table className="lg-table" style={g.minWidth ? { width: '100%', minWidth: g.minWidth } : undefined}>
          <colgroup><col style={{ width: 44 }} />{g.columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}<col style={{ width: 44 }} /></colgroup>
          <thead><tr><th className="lg-rownum">#</th>{g.columns.map((c) => <th key={c.key} className={c.type === 'money' ? 'lg-num' : ''}>{c.label}</th>)}<th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {all.map((row) => {
              const isNew = !row.id
              const groupHead = !single && row.day !== lastDay
              if (row.day !== lastDay) n = 0
              lastDay = row.day
              n++
              const r = vr++
              return [
                groupHead && <tr key={`d-${row.day}`} className="lg-day"><td colSpan={span}><span className="lg-dayhead">{prettyDay(row.day)}{kind === 'lines' && allBtns(row.day)}</span></td></tr>,
                <tr key={row.ck} id={row.id ? `receipt-${row.id}` : undefined} data-line={row.id || undefined} className={`${kind === 'lines' ? 'lg-receipt' : ''} ${isNew ? 'lg-new' : ''} ${row.items?.length ? 'lg-has-items' : ''} ${highlight && row.id === highlight ? 'lg-highlight' : ''}`}>
                  <td className="lg-rownum">{isNew ? '+' : n}</td>
                  {g.columns.map((col, c) => (
                    <td key={col.key} className={col.item ? 'lg-itemcol' : col.type === 'custom' ? 'lg-customcol' : incomeOff(row, col) ? 'lg-flag' : ''} title={incomeOff(row, col) ? `Total Income goes before the discount: Total Per Receipt ${peso(row.amountCents)} + Discounts ${peso(row.discountCents || 0)} = ${peso(row.amountCents + (row.discountCents || 0))}` : undefined}>{col.item ? receiptCell(row, col) : col.type === 'custom' ? col.render(row, { rerender, saved: !!row.id }) : <Cell col={col} value={row[col.key]} grid={kind} r={r} c={c}
                      ownerId={kind === 'lines' && col.key === 'petNames' ? row.ownerId : undefined}
                      onPickOwner={kind === 'lines' && col.key === 'clientName' ? (o) => {
                        patchRow(row.ck, { clientName: o.name, ownerId: o.id, ...(!row.petNames && o.pets.length === 1 ? { petNames: o.pets[0].name } : {}) })
                        save(row.ck)
                      } : undefined}
                      onPickPet={kind === 'lines' && col.key === 'petNames' ? (p, next) => {
                        patchRow(row.ck, { petNames: next, ...(!row.clientName && p.ownerName ? { clientName: p.ownerName, ownerId: p.ownerId } : {}) })
                        save(row.ck)
                      } : undefined}
                      onChange={(v) => { if (kind === 'lines' && col.key === 'clientName') patchRow(row.ck, { clientName: v, ownerId: null }); else set(row.ck, col.key, v) }}
                      onCommit={() => save(row.ck)} />}</td>
                  ))}
                  <td>{!isNew && delBtn(row.ck, 'row', () => remove(row))}</td>
                </tr>,
                ...(isShut(row) ? [] : row.items || []).map((it) => {
                  const ir = vr++
                  return (
                    <tr key={it.ck} className="lg-item" data-line={row.id || undefined}>
                      <td className="lg-rownum" aria-hidden>↳</td>
                      {g.columns.map((col, c) => (
                        <td key={col.key}>{col.item ? (
                          <Cell col={col.key === 'item' ? { ...col, label: 'Item' } : col.key === 'itemQty' ? { ...col, label: 'Quantity' } : { ...col, label: 'Item Amount' }}
                            value={col.key === 'item' ? it.item : col.key === 'itemQty' ? (it.qty ?? 1) : it.amountCents} grid={kind} r={ir} c={c} tag={col.key === 'item' ? it.ck : undefined}
                            onPick={col.key === 'item' ? (e) => { if (it.amountCents == null && e.price != null) { const u = Math.round(e.price * 100); setItem(row.ck, it.ck, 'unitCents', u); setItem(row.ck, it.ck, 'amountCents', Math.round(u * (it.qty || 1))) } } : undefined}
                            onChange={(v) => {
                              if (col.key === 'item') setItem(row.ck, it.ck, 'item', v)
                              else if (col.key === 'itemQty') { // the price of one stays; the amount follows
                                const q = Number(v) > 0 ? Number(v) : 1
                                const unit = it.unitCents ?? (it.amountCents != null ? Math.round(it.amountCents / (it.qty || 1)) : null)
                                setItem(row.ck, it.ck, 'qty', q); setItem(row.ck, it.ck, 'unitCents', unit); if (unit != null) setItem(row.ck, it.ck, 'amountCents', Math.round(unit * q))
                              } else { setItem(row.ck, it.ck, 'amountCents', v); if (it.qty) setItem(row.ck, it.ck, 'unitCents', v == null ? null : Math.round(v / it.qty)) }
                            }} onCommit={() => saveItem(row.ck, it.ck)} />
                        ) : null}</td>
                      ))}
                      <td>{delBtn(it.ck, 'item', () => removeItem(row, it))}</td>
                    </tr>
                  )
                }),
              ]
            })}
          </tbody>
          <tfoot><tr><td className="lg-rownum" />{g.columns.map((c, i) => <td key={c.key} className={c.total ? 'lg-num' : ''}>{c.total ? peso(totals[c.key]) : i === 0 ? 'Total' : ''}</td>)}<td /></tr></tfoot>
        </table>
      </div>
    </section>
  )
}

export default function DailyCashPage() {
  const staff = useStaff()
  const [params] = useSearchParams()
  const startDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '') ? params.get('day') : today() // ?day= from the Receipts page
  const [from, setFrom] = useState(startDay)
  const [to, setTo] = useState(startDay)
  const [calOpen, setCalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [copying, setCopying] = useState(false)
  const [stamp, setStamp] = useState(0) // bumped after an import, to load the sheets again
  const { data, error } = useApi(canManage(staff) ? `finances/daily?from=${from}&to=${to}${stamp ? `&v=${stamp}` : ''}` : null)
  const [gen, setGen] = useState(0) // remounts the grids whenever fresh data arrives
  useEffect(() => { if (data) setGen((g) => g + 1) }, [data])
  const [live, setLive] = useState(null) // the sheets as saved, for the summary without reloading
  useEffect(() => { if (data) setLive({ lines: data.lines, expenses: data.expenses, remits: data.remits }) }, [data])
  const single = from === to
  const s = useMemo(() => (live ? summarize(live) : null), [live])
  const head = <PageHead crumbs={[{ label: 'Finances' }, { label: 'Ledger' }]} title="Ledger" intro="The clinic’s cash ledger. Type in the cells like a spreadsheet; each cell saves when you leave it, and the totals add up by themselves." />
  if (!canManage(staff)) return <>{head}<ErrorNote error={new Error('Only an owner or admin can open the Ledger.')} /></>
  const refreshed = () => api(`finances/daily?from=${from}&to=${to}`).then((d) => setLive({ lines: d.lines, expenses: d.expenses, remits: d.remits })).catch(() => {})
  const pick = (a, b) => { setFrom(a); setTo(b); setCalOpen(false) }
  const label = single ? prettyDay(from) : `${prettyDay(from)} to ${prettyDay(to)}`
  return (
    <>
      {head}
      <div className="lg-bar">
        <div className="rc-wrap">
          <button type="button" className="btn btn-quiet" onClick={() => setCalOpen((o) => !o)} aria-expanded={calOpen}><CalendarDays aria-hidden /> {label}</button>
          {calOpen && <div className="rc-pop card"><RangeCalendar from={from} to={to} onPick={pick} book="owner" /></div>}
        </div>
        {!(single && from === today()) && <button type="button" className="text-btn" onClick={() => pick(today(), today())}>Today</button>}
        <button type="button" className="btn btn-quiet" onClick={() => setImporting((o) => !o)} aria-expanded={importing}><FileUp aria-hidden /> Import File</button>
        {single && <button type="button" className="btn btn-quiet" onClick={() => setComparing((o) => !o)} aria-pressed={comparing}><Scale aria-hidden /> Compare with Staff</button>}
        {single && <button type="button" className="btn btn-quiet" onClick={() => setCopying(true)}><Copy aria-hidden /> Copy from Staff</button>}
        <Link className="btn btn-quiet" to={`/finances/receipts${to === today() ? '' : `?day=${to}`}`} title="The front desk’s view of this day: photos and their typed summary"><ArrowLeftRight aria-hidden /> Staff View</Link>
        {single && data && data.from === from && data.to === to && <ClearDayButton day={from} book="owner" data={data} onDone={() => setStamp(Date.now())} />}
        {single && data && data.from === from && data.to === to && <ClearedBanner day={from} book="owner" cleared={data.cleared} onDone={() => setStamp(Date.now())} />}
        <button type="button" className="btn btn-quiet dc-print" onClick={() => window.print()}><Printer aria-hidden /> Print</button>
      </div>
      {copying && single && (
        <LedgerImport copyDay={from} onClose={() => setCopying(false)} onDone={() => { setCopying(false); setStamp(Date.now()) }} />
      )}
      {importing && (
        <LedgerImport fallbackDay={single ? from : null} onClose={() => setImporting(false)}
          onDone={(days) => { setImporting(false); if (days.length) { setFrom(days[0]); setTo(days[days.length - 1]) } setStamp(Date.now()) }} />
      )}
      <ErrorNote error={error} />
      {!data || !live || data.from !== from || data.to !== to ? <PawLoader label="Loading the ledger…" /> : (
        <div className="stack" style={{ gap: 16 }}>
          {comparing && single && <LedgerCompare key={`c-${from}-${gen}`} day={from} mine={live} />}
          <Grid key={`l-${from}-${to}-${gen}`} kind="lines" rows={data.lines} day={to} single={single} onSaved={refreshed} />
          <section className="card card-pad lg-summary">
            <h2>Summary{single ? '' : ' for These Dates'}</h2>
            <dl>
              <div><dt>Total Income ({s.receipts} receipt{s.receipts === 1 ? '' : 's'})</dt><dd>{peso(s.income)}</dd></div>
              <div><dt>Less Discounts</dt><dd>− {peso(s.discounts)}</dd></div>
              {s.discountsLeftOut > 0 && <div className="dc-sub dc-note"><dt>Not counted: {peso(s.discountsLeftOut)} on {s.discountsLeftOutOn.join(', ') || 'slips'} (no Total Income), so the Discounts column adds up to {peso(s.discounts + s.discountsLeftOut)}</dt></div>}
              <div className="dc-sub"><dt>Net Income</dt><dd>{peso(s.net)}</dd></div>
              <div><dt>Less Online Payments</dt><dd>− {peso(s.online)}</dd></div>
              <div className="dc-sub"><dt>Cash</dt><dd>{peso(s.cash)}</dd></div>
              <div><dt>Less Expenses</dt><dd>− {peso(s.expenses)}</dd></div>
              <div><dt>Less 1st Remit</dt><dd>− {peso(s.firstRemit)}</dd></div>
              <div className="dc-coh"><dt>Cash On Hand</dt><dd>{peso(s.cashOnHand)}</dd></div>
              {s.cashOnHand < 0 && <div className="lg-off"><dt>The expenses and 1st Remit are more than the cash ({peso(s.cash)}). Online payments are already taken out: only enter cash handed over as a remit.</dt></div>}
              <div><dt>2nd Remit</dt><dd>{s.hasSecond ? peso(s.secondRemit) : '—'}</dd></div>
              {s.hasSecond && <div className={s.difference === 0 ? 'lg-ok' : 'lg-off'}><dt>{s.difference === 0 ? '✓ Matches Cash On Hand' : s.difference < 0 ? 'Short' : 'Over'}</dt><dd>{s.difference === 0 ? '' : peso(Math.abs(s.difference))}</dd></div>}
              <div className="dc-coh"><dt>Total Commissions</dt><dd>{peso(s.commission)}</dd></div>
              <div className="dc-sub"><dt>Deposits</dt><dd>{peso(s.deposits)}</dd></div>
              <div className="dc-sub"><dt>Balances</dt><dd>{peso(s.balances)}</dd></div>
              <div className="dc-sub"><dt>Total Per Receipt</dt><dd>{peso(s.receiptsTotal)}</dd></div>
            </dl>
            <p className="field-hint" style={{ margin: 0 }}>Commissions aren’t taken out of the cash; when they’re paid, add them under Expenses (type Vet Commission).</p>
          </section>
          <div className="lg-pair">
            <Grid key={`e-${from}-${to}-${gen}`} kind="expenses" rows={data.expenses} day={to} single={single} onSaved={refreshed} />
            <Grid key={`r-${from}-${to}-${gen}`} kind="remits" rows={data.remits} day={to} single={single} onSaved={refreshed} />
          </div>
        </div>
      )}
    </>
  )
}
