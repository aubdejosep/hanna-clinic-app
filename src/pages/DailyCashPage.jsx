// Finances ▸ Ledger (every staff member): the clinic's cash ledger, one record per day. Staff upload the day's
// receipt photos; the app reads each one (lib/receipt-reader.js) into a row marked Read by App. Staff Review each
// receipt against its photo and approve it, then Mark Day Done (the owners get a bell). Owners and admins review and
// approve each row (Approved by Owner locks it for staff), see what needs attention, and mark the Day Checked.
// Columns: Status | Photo | Receipt No. OR | QR | Owner's Name | Pet's Name | Item | Amount | Total Per Receipt |
// Discounts | Paid With | Notes | Online Payments | Deposit | Balance | Total Income | (owners and admins: Commissions,
// Owner Notes). A receipt can be split into its items (+ Item). Then the Summary (Total Income (before discounts) -
// Discounts - Online - Expenses - 1st Remit = Cash On Hand, checked against the 2nd Remit), Expenses and Remits.
// Each cell saves when you leave it. Owners and admins can also pick several days (drag on the calendar).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BadgeCheck, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, ClipboardCheck, Ellipsis, FileUp, Flag, ImagePlus, PanelRight, Plus, Printer, ScanText, Trash2, TriangleAlert, Unlock, X } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { EXPENSE_TYPES, summarize } from '../../lib/daily-cash.js'
import { flagsOf, gapsOf } from '../lib/ledger-flags.js'
import LedgerImport from '../components/LedgerImport.jsx'
import { ClearDayButton, ClearedBanner } from '../components/ClearDay.jsx'
import { PhotoPanel, needsMe, openTyping, saveRotation } from '../components/ReceiptTyping.jsx'
import { Lightbox, PhotoCell, uploadPhoto } from '../components/LedgerPhotos.jsx'

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
      { key: 'itemAmount', label: 'Amount', type: 'money', width: '6.5%', item: true },
      { key: 'amountCents', label: 'Total Per Receipt', type: 'money', total: true, width: '7.5%' },
      { key: 'discountCents', label: 'Discounts', type: 'money', total: true, width: '6.5%' },
      { key: 'note', label: 'Notes', type: 'long', width: '12%' },
      { key: 'onlineCents', label: 'Online Payments', type: 'money', total: true, width: '7%' },
      { key: 'depositCents', label: 'Deposit', type: 'money', total: true, width: '6%' },
      { key: 'balanceCents', label: 'Balance', type: 'money', total: true, width: '6%' },
      { key: 'incomeCents', label: 'Total Income', type: 'money', total: true, width: '7%' },
      { key: 'commissionCents', label: 'Commissions', type: 'money', total: true, width: '7%' },
    ],
    blank: (day) => ({ day, receiptNo: '', receiptQr: '', clientName: '', petNames: '', amountCents: null, discountCents: null, paidWith: '', note: '', onlineCents: null, depositCents: null, balanceCents: null, incomeCents: null, items: [] }),
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
export function RangeCalendar({ from, to, onPick }) {
  const [month, setMonth] = useState(to.slice(0, 7))
  const [sel, setSel] = useState(null) // {a, b} while dragging
  const anchor = useRef(null)
  const first = new Date(`${month}-01T12:00:00Z`)
  const start = shift(`${month}-01`, -((first.getUTCDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => shift(start, i))
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
            className={`rc-day ${d.slice(0, 7) !== month ? 'is-out' : ''} ${d >= lo && d <= hi ? 'is-in' : ''} ${d === lo || d === hi ? 'is-end' : ''} ${d === today() ? 'is-today' : ''}`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(d, d) } }}>{Number(d.slice(8))}</button>
        ))}
      </div>
      <p className="field-hint" style={{ margin: 0 }}>Tap a day, or drag across days to see several together.</p>
    </div>
  )
}

function Cell({ col, value, onChange, onCommit, r, c, grid, tag, readOnly }) {
  const [text, setText] = useState(col.type === 'money' ? toPesos(value) : value ?? '')
  const [focus, setFocus] = useState(false)
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
  const common = { 'data-grid': grid, 'data-r': r, 'data-c': c, 'data-tag': tag, 'aria-label': col.label, onKeyDown: nav, onFocus: () => setFocus(true), ...(readOnly ? { readOnly: true, 'aria-readonly': true } : {}) }
  if (col.type === 'select') {
    return <select {...common} disabled={readOnly} className="lg-cell" value={value ?? ''} onChange={(e) => { onChange(e.target.value); onCommit({ [col.key]: e.target.value }) }} onBlur={() => setFocus(false)}>{col.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
  }
  if (col.type === 'date') {
    return <input {...common} type="date" className="lg-cell" value={value || ''} onChange={(e) => e.target.value && onChange(e.target.value)} onBlur={(e) => { setFocus(false); onCommit({ day: e.target.value || value }) }} />
  }
  if (col.type === 'long') {
    // Notes: wraps and grows so the whole note shows; Enter still moves down (Shift+Enter for a new line).
    const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }
    return (
      <textarea {...common} ref={grow} rows={1} className="lg-cell lg-wrap" value={text} maxLength={300}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) return; if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return; nav(e) }}
        onChange={(e) => { setText(e.target.value); grow(e.target) }}
        onBlur={() => { setFocus(false); if (readOnly) return; const v = text.trim(); if (v !== (value ?? '')) { onChange(v); onCommit({ [col.key]: v }) } }} />
    )
  }
  return (
    <input {...common} className={`lg-cell ${col.type === 'money' ? 'lg-num' : ''}`} inputMode={col.type === 'money' ? 'decimal' : undefined} value={focus || col.type !== 'money' ? text : text === '' ? '' : (toCents(text) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}
      onChange={(e) => setText(e.target.value)} maxLength={col.type === 'money' ? 14 : 300}
      onBlur={() => {
        setFocus(false)
        if (readOnly) return
        const v = col.type === 'money' ? toCents(text) : text.trim()
        if (Number.isNaN(v)) { setText(toPesos(value)); return }
        if (v !== (value ?? (col.type === 'money' ? null : ''))) { onChange(v); onCommit({ [col.key]: v }) }
      }} />
  )
}

// One sheet. Rows live in a ref (the latest values, changed the moment a cell changes) and keep the same on-screen
// key from the first keystroke, so a row being saved for the first time is never redrawn (nothing half-typed is
// lost). Saves run one after another and always send the row as it is now. With several days picked, rows are
// grouped under their date and there's no empty row (rows are added on a single day).
let nextKey = 1
const withKey = (r) => ({ ...r, ck: `k${nextKey++}` })
// config: the columns (default GRIDS[kind]); prepare(row) works out Total Income and Online from Paid With when the
// total, discount or Paid With changes; custom columns ({type: 'custom', render(row, api)}) draw their own cell;
// locked(row): shown but not editable (a receipt an owner approved, for staff); rowClass(row): extra row classes.
// Receipts save only the cell that changed (the server keeps each change in the receipt's history).
const MONEY_KEYS = ['amountCents', 'discountCents', 'paidWith']
const META = ['ck', 'kindNo', 'items', 'photo', 'photoRotate', 'photoV', 'ai', 'dupes', 'stage', 'staffApprovedAt', 'staffApprovedBy', 'ownerApprovedAt', 'ownerApprovedBy']
export function Grid({ kind, rows, day, single, onSaved, config, prepare, highlight, locked, rowClass }) {
  const isLocked = (row) => !!(locked && row.id && locked(row))
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
  function setItem(ck, ick, k, v) { const it = findItem(find(ck), ick); if (it) { it[k] = v; rerender() } }
  const queue = (job) => { saving.current = saving.current.then(job) }
  function save(ck, key) {
    const keys = [].concat(key)
    queue(async () => {
      const row = find(ck)
      if (!row) return
      const money = prepare && (!row.id || keys.some((k) => MONEY_KEYS.includes(k))) ? prepare(row) : {}
      Object.assign(row, money)
      const body = Object.fromEntries(Object.entries(row).filter(([k]) => !META.includes(k)))
      try {
        if (row.id && kind === 'lines') {
          const r = await api(`finances/daily/${kind}/${row.id}`, { method: 'PATCH', body: { ...Object.fromEntries(keys.map((k) => [k, row[k]])), ...money } })
          if (r.row?.ai !== undefined) row.ai = r.row.ai
        } else if (row.id) await api(`finances/daily/${kind}/${row.id}`, { method: 'PATCH', body })
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
      const body = { lineId: row.id, item: it.item, amountCents: it.amountCents }
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
          {count > 0 && <button type="button" className="lg-toggle" onClick={() => toggle(row)} aria-expanded={!isShut(row)} title={isShut(row) ? 'Show the items' : 'Hide the items'}><Chev aria-hidden /> {count} Item{count === 1 ? '' : 's'}</button>}
          {!isLocked(row) && <button type="button" className="lg-additem" onClick={() => addItem(row)} disabled={!row.id} title={row.id ? 'Add an item to this receipt' : 'Type the receipt first'} aria-label="Add Item"><Plus aria-hidden />{count ? '' : ' Item'}</button>}
        </span>
      )
    }
    if (!row.items?.length) return null
    const sum = itemSum(row)
    const due = sum - (row.discountCents || 0)
    const ok = !row.amountCents || due === row.amountCents
    return <span className={`lg-sum ${ok ? '' : 'is-off'}`} title={`Items ${peso(sum)}${row.discountCents ? ` − discount ${peso(row.discountCents)} = ${peso(due)}` : ''}${ok ? '' : `; Total Per Receipt is ${peso(row.amountCents)}`}`}>{ok ? '' : '≠ '}{peso(sum)}</span>
  }
  return (
    <section className="card lg-card">
      <div className="card-head"><h2>{g.title}</h2>{kind === 'lines' && allBtns()}<span className="cell-sub">{g.hint ? `${g.hint} ` : ''}{saved.length} row{saved.length === 1 ? '' : 's'}{single ? ' · type in the last row to add one' : ' · pick one day to add rows'}</span></div>
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
                <tr key={row.ck} id={row.id ? `receipt-${row.id}` : undefined} data-line={row.id || undefined} className={`${isNew ? 'lg-new' : ''} ${row.items?.length ? 'lg-has-items' : ''} ${highlight && row.id === highlight ? 'lg-highlight' : ''} ${isLocked(row) ? 'lg-locked' : ''} ${rowClass ? rowClass(row) : ''}`}>
                  <td className="lg-rownum">{isNew ? '+' : n}</td>
                  {g.columns.map((col, c) => (
                    <td key={col.key} className={col.item ? 'lg-itemcol' : col.type === 'custom' ? 'lg-customcol' : incomeOff(row, col) ? 'lg-flag' : ''} title={incomeOff(row, col) ? `Total Income goes before the discount: Total Per Receipt ${peso(row.amountCents)} + Discounts ${peso(row.discountCents || 0)} = ${peso(row.amountCents + (row.discountCents || 0))}` : undefined}>{col.item ? receiptCell(row, col) : col.type === 'custom' ? col.render(row, { rerender, saved: !!row.id, r, c, grid: kind, locked: isLocked(row), set: (k, v) => set(row.ck, k, v), save: (k) => save(row.ck, k) }) : <Cell col={col} value={row[col.key]} grid={kind} r={r} c={c} readOnly={isLocked(row)} onChange={(v) => set(row.ck, col.key, v)} onCommit={(p) => save(row.ck, Object.keys(p)[0])} />}</td>
                  ))}
                  <td>{!isNew && !isLocked(row) && delBtn(row.ck, 'row', () => remove(row))}</td>
                </tr>,
                ...(isShut(row) ? [] : row.items || []).map((it) => {
                  const ir = vr++
                  return (
                    <tr key={it.ck} className="lg-item" data-line={row.id || undefined}>
                      <td className="lg-rownum" aria-hidden>↳</td>
                      {g.columns.map((col, c) => (
                        <td key={col.key}>{col.item ? (
                          <Cell col={col.key === 'item' ? { ...col, label: 'Item' } : { ...col, label: 'Item Amount' }} value={col.key === 'item' ? it.item : it.amountCents} grid={kind} r={ir} c={c} tag={col.key === 'item' ? it.ck : undefined} readOnly={isLocked(row)}
                            onChange={(v) => setItem(row.ck, it.ck, col.key === 'item' ? 'item' : 'amountCents', v)} onCommit={() => saveItem(row.ck, it.ck)} />
                        ) : null}</td>
                      ))}
                      <td>{!isLocked(row) && delBtn(it.ck, 'item', () => removeItem(row, it))}</td>
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

// ---------- The Ledger page (everyone) ----------
const PAID = [['', '—'], ['cash', 'Cash'], ['gcash', 'GCash'], ['bank', 'Bank Transfer'], ['maribank', 'MariBank'], ['card', 'Card'], ['qrph', 'QRPH'], ['none', 'Not Counted']]
const PAID_NAME = Object.fromEntries(PAID)
const ONLINE = ['gcash', 'bank', 'maribank', 'card', 'qrph']
// Paid With decides Total Income (the price before the discount) and Online.
function prepare(row) {
  if (row.paidWith === 'none') return { incomeCents: null, onlineCents: null }
  if (row.amountCents == null || !row.paidWith) return {}
  return { incomeCents: row.amountCents + (row.discountCents || 0), onlineCents: ONLINE.includes(row.paidWith) ? row.amountCents : null }
}
// [name, badge class, what it means, short label for the grid]
const STAGES = { draft: ['Read by App', 'badge-warn', 'To check: read by the app or just added', 'To Check'], staff: ['Approved by Staff', 'badge-soft', 'Approved by staff; waiting for an owner', 'Staff ✓'], owner: ['Approved by Owner', '', 'Approved by an owner', 'Owner ✓'] }
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : '')
const FIELD_LABEL = { receiptNo: 'Receipt No. OR', receiptQr: 'Receipt No. QR', clientName: 'Owner’s Name', petNames: 'Pet’s Name', note: 'Notes', amountCents: 'Total Per Receipt',
  discountCents: 'Discounts', onlineCents: 'Online Payments', depositCents: 'Deposit', balanceCents: 'Balance', incomeCents: 'Total Income', commissionCents: 'Commissions',
  paidWith: 'Paid With', issueNote: 'To Discuss', ownerNote: 'Owner Notes' }
const shown = (field, v) => (v == null || v === '' ? '(blank)' : field.endsWith('Cents') ? peso(Number(v)) : field === 'paidWith' ? PAID_NAME[v] || v : `“${v}”`)

// A receipt's history: what the app read, who approved it and what anyone changed. Owners can reopen an approved one.
function ReceiptHistory({ row, manager, onClose, onReopened }) {
  const toast = useToast()
  const { data, error } = useApi(`finances/daily/lines/${row.id}/history`)
  const [busy, setBusy] = useState(false)
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  async function reopen() {
    setBusy(true)
    try { const r = await api('finances/daily/reopen', { method: 'POST', body: { id: row.id } }); toast('Reopened: staff can change it again'); onReopened(r.stage) } catch (err) { toast(err.message) }
    setBusy(false)
  }
  const text = (h) => {
    if (h.field === 'added') return 'Added'
    if (h.field === 'removed') return 'Removed'
    if (h.field === 'photo') return h.newValue
    if (h.field === 'read') return `The app read the photo: ${h.newValue}`
    if (h.field === 'stage') return h.newValue
    if (h.field === 'item') return h.oldValue && h.newValue ? `Item ${h.oldValue} → ${h.newValue}` : h.newValue ? `Item added: ${h.newValue}` : `Item removed: ${h.oldValue}`
    if (h.field === 'staff_version') {
      const v = h.newValue || {}
      return `Staff’s own record of this receipt, before the Ledger was combined: ${[v.receiptQr && `QR ${v.receiptQr}`, v.receiptNo && `OR ${v.receiptNo}`, v.clientName, v.amountCents != null && peso(v.amountCents), v.paidWith && PAID_NAME[v.paidWith]].filter(Boolean).join(', ') || '(blank)'}`
    }
    return `${FIELD_LABEL[h.field] || h.field}: ${h.oldValue == null ? `set to ${shown(h.field, h.newValue)}` : `${shown(h.field, h.oldValue)} → ${shown(h.field, h.newValue)}`}`
  }
  const who = (h) => (h.source === 'app' ? 'Photo reading' : h.by || (h.source === 'system' ? 'The app' : ''))
  return (
    <div className="bal-alert-backdrop" onClick={onClose}>
      <div className="card clear-dialog lg-history" role="dialog" aria-modal="true" aria-labelledby="hist-title" onClick={(e) => e.stopPropagation()}>
        <div className="pp-head"><h2 id="hist-title">{row.receiptQr ? `QR ${row.receiptQr}` : row.receiptNo ? `OR ${row.receiptNo}` : 'Receipt'}{row.clientName ? ` · ${row.clientName}` : ''}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close"><X /></button></div>
        <p className="cell-sub" style={{ margin: 0 }}>{STAGES[row.stage]?.[2]}.{row.staffApprovedBy ? ` Staff: ${row.staffApprovedBy}${row.staffApprovedAt ? `, ${when(row.staffApprovedAt)}` : ''}.` : ''}{row.ownerApprovedBy ? ` Owner: ${row.ownerApprovedBy}${row.ownerApprovedAt ? `, ${when(row.ownerApprovedAt)}` : ''}.` : ''}</p>
        {flagsOf(row, row.day).length > 0 && <ul className="lg-flaglist">{flagsOf(row, row.day).map((f) => <li key={f.text} className={f.open ? 'is-open' : ''}>{f.text}</li>)}</ul>}
        <ErrorNote error={error} />
        {!data ? <PawLoader label="Loading the history…" /> : (
          <ol className="lg-histlist">
            {data.history.length === 0 && <li><span>{data.created.by ? `Added by ${data.created.by}` : 'Added'}</span><time>{when(data.created.at)}</time></li>}
            {data.history.map((h) => <li key={h.id}><span>{text(h)}<em> · {who(h)}</em></span><time>{when(h.at)}</time></li>)}
          </ol>
        )}
        {manager && row.stage === 'owner' && <div className="inline-row"><button type="button" className="btn btn-quiet" onClick={reopen} disabled={busy}><Unlock aria-hidden /> Reopen for Changes</button></div>}
      </div>
    </div>
  )
}

// Receipt No.: one column for both kinds of slip. The QR/OR button beside the number says which (quotation slip
// or service invoice) and switches it; saved as Receipt No. QR or OR as before.
function ReceiptNoCell({ row, tools }) {
  const kind = row.kindNo || (row.receiptNo && !row.receiptQr ? 'OR' : 'QR')
  const value = kind === 'OR' ? row.receiptNo : row.receiptQr
  const put = (k, v) => { tools.set(k === 'OR' ? 'receiptNo' : 'receiptQr', v); tools.set(k === 'OR' ? 'receiptQr' : 'receiptNo', '') }
  function flip() {
    const to = kind === 'OR' ? 'QR' : 'OR'
    tools.set('kindNo', to)
    put(to, value || '')
    if (value) tools.save(['receiptNo', 'receiptQr'])
  }
  return (
    <span className="lg-rno">
      <button type="button" className="lg-rkind" onClick={flip} disabled={tools.locked} aria-label={`${kind === 'QR' ? 'Quotation slip (QR)' : 'Service invoice (OR)'}: switch to ${kind === 'QR' ? 'OR' : 'QR'}`}
        title={kind === 'QR' ? 'QR: quotation slip. Tap to make it OR (service invoice).' : 'OR: service invoice. Tap to make it QR (quotation slip).'}>{kind}</button>
      <Cell col={{ key: 'receiptNum', label: `Receipt No. ${kind}` }} value={value} grid={tools.grid} r={tools.r} c={tools.c} readOnly={tools.locked}
        onChange={(v) => put(kind, v)} onCommit={() => tools.save(['receiptNo', 'receiptQr'])} />
    </span>
  )
}

// The photo panel needs room beside the grid: computers only.
function useWide() {
  const q = '(min-width: 1180px)'
  const [w, setW] = useState(() => window.matchMedia(q).matches)
  useEffect(() => { const m = window.matchMedia(q); const on = () => setW(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on) }, [])
  return w
}

// Read photos with the app, 3 at a time. Stops at the first "not set up" / "out of credits" answer.
async function readPhotos(ids, again, onStep) {
  let done = 0
  let failed = 0
  let stop = null
  const queue = [...ids]
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !stop) {
      const id = queue.shift()
      try { await api(`finances/daily/read/${id}`, { method: 'POST', body: { again } }) } catch (err) { failed++; if (err.status === 503) stop = err.message }
      onStep(++done)
    }
  }))
  return { failed, stop }
}

export default function DailyCashPage() {
  const staff = useStaff()
  const manager = canManage(staff)
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const startDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '') ? params.get('day') : today() // ?day= from the bell
  const [from, setFrom] = useState(startDay)
  const [to, setTo] = useState(startDay)
  useEffect(() => { if (params.get('day') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('day'))) { setFrom(params.get('day')); setTo(params.get('day')) } }, [params])
  const [highlight, setHighlight] = useState(Number(params.get('r')) || null)
  const [calOpen, setCalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [stamp, setStamp] = useState(0) // bumped to load the day again
  const { data, error } = useApi(`finances/daily?from=${from}&to=${to}${stamp ? `&v=${stamp}` : ''}`)
  const [gen, setGen] = useState(0) // remounts the grids whenever fresh data arrives
  useEffect(() => { if (data) setGen((g) => g + 1) }, [data])
  const [live, setLive] = useState(null) // the sheets as saved, for the summary and flags without reloading
  useEffect(() => { if (data) setLive({ lines: data.lines, expenses: data.expenses, remits: data.remits }) }, [data])
  const single = from === to
  const day = from
  const s = useMemo(() => (live ? summarize(live) : null), [live])
  const [upload, setUpload] = useState(null) // { what, done, total }
  const [offer, setOffer] = useState(0)
  const [history, setHistory] = useState(null)
  const [approveAll, setApproveAll] = useState(false)
  const wide = useWide()
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem('receipts-photo-panel') !== '0' } catch { return true } })
  const showPanel = (v) => { setPanel(v); try { localStorage.setItem('receipts-photo-panel', v ? '1' : '0') } catch { /* private window */ } }
  const [focusId, setFocusId] = useState(null)
  const [open, setOpen] = useState(null) // the big photo
  const bulk = useRef(null)
  const ready = data && live && data.from === from && data.to === to
  useEffect(() => {
    const on = (e) => { if (e.detail?.day === day) setStamp(Date.now()) }
    window.addEventListener('hanna:receipts-changed', on)
    return () => window.removeEventListener('hanna:receipts-changed', on)
  }, [day])
  useEffect(() => { if (ready && highlight) requestAnimationFrame(() => document.getElementById(`receipt-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })) }, [ready, highlight, gen])

  const refreshed = () => api(`finances/daily?from=${from}&to=${to}`).then((d) => setLive({ lines: d.lines, expenses: d.expenses, remits: d.remits })).catch(() => {})
  const reload = () => setStamp(Date.now())
  const pick = (a, b) => { const z = manager ? b : a; setFrom(a); setTo(z); setCalOpen(false); setHighlight(null); if (params.get('day') || params.get('r')) setParams({}) }
  const lines = live?.lines || []
  const mineToApprove = lines.filter((l) => needsMe(l, manager))
  const unread = lines.filter((l) => l.photo && l.stage !== 'owner' && (!l.ai || l.ai.error))
  const dayInfo = data?.days?.[day] || {}
  const review = (startId) => openTyping({ day, lines, startId, manager, fresh: true })

  async function uploadMany(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'))
    if (!list.length) return
    setUpload({ what: 'Uploading', done: 0, total: list.length })
    const ids = []
    let failed = 0
    for (let i = 0; i < list.length; i++) {
      try {
        const r = await api('finances/daily/lines', { method: 'POST', body: { day } })
        await uploadPhoto(r.row.id, list[i])
        ids.push(r.row.id)
      } catch { failed++ }
      setUpload({ what: 'Uploading', done: i + 1, total: list.length })
    }
    let readNote = ''
    if (ids.length && data.reading) {
      setUpload({ what: 'Reading', done: 0, total: ids.length })
      const r = await readPhotos(ids, false, (done) => setUpload({ what: 'Reading', done, total: ids.length }))
      readNote = r.stop ? ` ${r.stop}` : r.failed ? ` ${r.failed} couldn’t be read: type those in.` : ''
    }
    setUpload(null)
    reload()
    if (ids.length) setOffer(ids.length)
    toast(`${ids.length} photo${ids.length === 1 ? '' : 's'} added${failed ? `; ${failed} didn’t upload (add those with the camera button on a row)` : ''}.${readNote}`)
  }
  async function readUnread() {
    setUpload({ what: 'Reading', done: 0, total: unread.length })
    const r = await readPhotos(unread.map((l) => l.id), true, (done) => setUpload({ what: 'Reading', done, total: unread.length }))
    setUpload(null)
    reload()
    toast(r.stop || (r.failed ? `${unread.length - r.failed} read; ${r.failed} couldn’t be read: type those in.` : `${unread.length} photo${unread.length === 1 ? '' : 's'} read. Review them next.`))
  }
  async function approveRows(ids) {
    try {
      const r = await api('finances/daily/approve', { method: 'POST', body: { ids } })
      toast(r.approved ? `${r.approved} receipt${r.approved === 1 ? '' : 's'} approved` : 'Nothing to approve')
      reload()
    } catch (err) { toast(err.message) }
  }
  async function markDay(step, done) {
    try {
      await api('finances/daily/day', { method: 'POST', body: { day, step, done } })
      toast(done ? (step === 'staff' ? 'Day marked done. The owners will see it’s ready to check.' : 'Day checked') : 'Reopened')
      reload()
    } catch (err) { toast(err.message) }
  }

  const config = useMemo(() => {
    const pickCol = (k) => GRIDS.lines.columns.find((c) => c.key === k)
    return {
      ...GRIDS.lines,
      minWidth: manager ? 1900 : 1620,
      columns: [
        { key: 'status', label: 'Status', type: 'custom', width: '8%', render: (row, tools) => row.id && (
          <span className="lg-status">
            <button type="button" className={`badge ${STAGES[row.stage]?.[1] || ''}`} onClick={() => setHistory(row)} title={`${STAGES[row.stage]?.[0]}: ${STAGES[row.stage]?.[2]}. Tap for its history.`}>{STAGES[row.stage]?.[3]}</button>
            {needsMe(row, manager) && <button type="button" className="icon-btn lg-approve" title="Approve this receipt" aria-label="Approve"
              onClick={async () => { try { const r = await api('finances/daily/approve', { method: 'POST', body: { ids: [row.id] } }); if (r.approved) { Object.assign(row, { stage: r.stage }, manager ? { ownerApprovedAt: r.at, ownerApprovedBy: r.by } : { staffApprovedAt: r.at, staffApprovedBy: r.by }); tools.rerender(); refreshed() } } catch (err) { toast(err.message) } }}><Check /></button>}
            {flagsOf(row, row.day).some((f) => f.open) && <span className="lg-flagdot" title={flagsOf(row, row.day).filter((f) => f.open).map((f) => f.text).join('\n')}><TriangleAlert aria-hidden /></span>}
          </span>) },
        { key: 'photo', label: 'Photo', type: 'custom', width: '4.5%', render: (row, tools) => <PhotoCell row={row} tools={tools} onOpen={setOpen} locked={!manager && row.stage === 'owner'} /> },
        { key: 'receipt', label: 'Receipt No.', type: 'custom', width: '9%', render: (row, tools) => <ReceiptNoCell row={row} tools={tools} /> },
        ...['clientName', 'petNames', 'item', 'itemAmount', 'amountCents', 'discountCents'].map(pickCol),
        { key: 'paidWith', label: 'Paid With', type: 'select', options: PAID, width: '7%' },
        ...['note', 'onlineCents', 'depositCents', 'balanceCents', 'incomeCents'].map(pickCol),
        ...(manager ? [pickCol('commissionCents'), { key: 'ownerNote', label: 'Owner Notes', type: 'long', width: '10%' }] : []),
      ],
    }
  }, [manager]) // eslint-disable-line react-hooks/exhaustive-deps

  // Needs Attention: receipts with something to sort out, numbers missing in the run, rows still to approve.
  const attention = ready && single ? lines.map((l) => ({ l, f: flagsOf(l, day).filter((x) => x.open) })).filter((x) => x.f.length) : []
  const gaps = ready && single ? gapsOf(lines) : []
  const onlineList = lines.filter((l) => l.onlineCents > 0)
  const grooming = lines.flatMap((l) => (l.items || []).filter((i) => /groom/i.test(i.item)).map((i) => ({ ...i, client: l.clientName })))
  const label = single ? prettyDay(from) : `${prettyDay(from)} to ${prettyDay(to)}`
  return (
    <>
      <PageHead crumbs={[{ label: 'Finances' }, { label: 'Ledger' }]} title="Ledger"
        intro={manager ? 'The day’s receipts, read from their photos and checked by staff. Review and approve each receipt; anything that doesn’t match is listed under Needs Attention.' : 'Upload the day’s receipt photos: the app reads them for you. Then Review each receipt against its photo, approve it, and Mark Day Done.'} />
      <div className="lg-bar">
        {single && <button type="button" className="icon-btn" onClick={() => pick(shift(day, -1), shift(day, -1))} aria-label="Previous day" title="Previous Day"><ChevronLeft /></button>}
        <div className="rc-wrap">
          <button type="button" className="btn btn-quiet" onClick={() => setCalOpen((o) => !o)} aria-expanded={calOpen}><CalendarDays aria-hidden /> {label}</button>
          {calOpen && <div className="rc-pop card"><RangeCalendar from={from} to={to} onPick={pick} /></div>}
        </div>
        {single && <button type="button" className="icon-btn" onClick={() => pick(shift(day, 1), shift(day, 1))} aria-label="Next day" title="Next Day"><ChevronRight /></button>}
        {!(single && from === today()) && <button type="button" className="text-btn" onClick={() => pick(today(), today())}>Today</button>}
        <input ref={bulk} type="file" accept="image/*" multiple hidden onChange={(e) => { uploadMany(e.target.files); e.target.value = '' }} />
        {single && <button type="button" className="btn" onClick={() => bulk.current.click()} disabled={!!upload || !ready}><ImagePlus aria-hidden /> {upload ? `${upload.what} ${upload.done} of ${upload.total}…` : 'Upload Photos'}</button>}
        {single && ready && lines.length > 0 && <button type="button" className={`btn ${mineToApprove.length ? '' : 'btn-quiet'}`} onClick={() => review()}><ClipboardCheck aria-hidden /> Review{mineToApprove.length ? ` (${mineToApprove.length} to Approve)` : ''}</button>}
        {single && ready && data.reading && unread.length > 0 && !upload && <button type="button" className="btn btn-quiet" onClick={readUnread} title="Read the photos the app hasn’t read yet (e.g. from before photo reading started)"><ScanText aria-hidden /> Read {unread.length} Photo{unread.length === 1 ? '' : 's'}</button>}
        {manager && ready && mineToApprove.length > 0 && (approveAll
          ? <button type="button" className="btn is-confirm" onClick={() => { setApproveAll(false); approveRows(mineToApprove.map((l) => l.id)) }} onBlur={() => setApproveAll(false)}>Tap Again: Approve {mineToApprove.length}</button>
          : <button type="button" className="btn btn-quiet" onClick={() => setApproveAll(true)} title={single ? 'Approve every receipt still waiting on this day' : 'Approve every receipt still waiting on these days'}><CheckCheck aria-hidden /> Approve All</button>)}
        {single && ready && !dayInfo.staffDoneAt && lines.length > 0 && <button type="button" className="btn btn-quiet" onClick={() => markDay('staff', true)} title="Tell the owners this day is ready to check"><Flag aria-hidden /> Mark Day Done</button>}
        {single && ready && manager && dayInfo.staffDoneAt && !dayInfo.ownerDoneAt && <button type="button" className="btn btn-quiet" onClick={() => markDay('owner', true)} title="Every receipt approved, or noted to discuss"><BadgeCheck aria-hidden /> Day Checked</button>}
        {single && ready && <ClearedBanner day={day} book="owner" cleared={manager ? data.cleared : null} onDone={reload} />}
        <details className="lg-more">
          <summary className="btn btn-quiet"><Ellipsis aria-hidden /> More</summary>
          <div className="card lg-more-pop">
            {manager && <button type="button" className="btn btn-quiet" onClick={(e) => { e.currentTarget.closest('details').open = false; setImporting(true) }}><FileUp aria-hidden /> Import File</button>}
            {wide && !panel && <button type="button" className="btn btn-quiet" onClick={() => showPanel(true)}><PanelRight aria-hidden /> Photo Panel</button>}
            {manager && single && ready && <ClearDayButton day={day} book="owner" data={data} onDone={reload} />}
            <button type="button" className="btn btn-quiet dc-print" onClick={() => window.print()}><Printer aria-hidden /> Print</button>
          </div>
        </details>
      </div>
      {single && ready && (dayInfo.staffDoneAt || dayInfo.ownerDoneAt) && (
        <p className="lg-daystatus">
          {dayInfo.staffDoneAt && <span><Flag aria-hidden /> Marked done by {dayInfo.staffDoneBy}, {when(dayInfo.staffDoneAt)}{!dayInfo.ownerDoneAt && <> · <button type="button" className="text-btn" onClick={() => markDay('staff', false)}>Undo</button></>}</span>}
          {dayInfo.ownerDoneAt && <span><BadgeCheck aria-hidden /> Checked by {dayInfo.ownerDoneBy}, {when(dayInfo.ownerDoneAt)}{manager && <> · <button type="button" className="text-btn" onClick={() => markDay('owner', false)}>Undo</button></>}</span>}
        </p>
      )}
      {importing && (
        <LedgerImport fallbackDay={single ? from : null} onClose={() => setImporting(false)}
          onDone={(days) => { setImporting(false); if (days.length) { setFrom(days[0]); setTo(manager ? days[days.length - 1] : days[0]) } reload() }} />
      )}
      <ErrorNote error={error} />
      {!ready ? <PawLoader label="Loading the ledger…" /> : (
        <div className="stack" style={{ gap: 16 }}>
          {offer > 0 && (
            <div className="rc-offer card card-pad">
              <span><strong>{offer} photo{offer === 1 ? '' : 's'} added{data.reading ? ' and read' : ''}.</strong> Review them one at a time, with each photo big on screen?</span>
              <button type="button" className="btn" onClick={() => { setOffer(0); review() }}><ClipboardCheck aria-hidden /> Start Review</button>
              <button type="button" className="text-btn" onClick={() => setOffer(0)}>Later</button>
            </div>
          )}
          {single && !data.reading && lines.some((l) => l.photo && !l.ai) && manager && <p className="field-hint" style={{ margin: 0 }}>Photo reading is off: the app can’t see the Anthropic key yet, so photos are kept but not read. A key added in Cloudflare starts working after the next deployment (Deployments ▸ Retry deployment), and only if it’s under Production.</p>}
          {(attention.length > 0 || gaps.length > 0) && (
            <section className="card card-pad lg-attention" aria-labelledby="att-title">
              <h2 id="att-title"><TriangleAlert aria-hidden /> Needs Attention</h2>
              <ul>
                {attention.map(({ l, f }) => (
                  <li key={l.id}>
                    <button type="button" className="text-btn" onClick={() => { setHighlight(l.id); requestAnimationFrame(() => document.getElementById(`receipt-${l.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })) }}>
                      {l.receiptQr ? `QR ${l.receiptQr}` : l.receiptNo ? `OR ${l.receiptNo}` : 'No number'}{l.clientName ? ` · ${l.clientName}` : ''}
                    </button>
                    <span>{f.map((x) => x.text).join(' · ')}</span>
                  </li>
                ))}
                {gaps.map((g) => <li key={g}><span>{g}: was it left out, or voided?</span></li>)}
              </ul>
            </section>
          )}
          <div className={wide && panel && single ? 'rc-split' : ''} onFocus={(e) => { const id = Number(e.target.closest('tr[data-line]')?.dataset.line); if (id) setFocusId(id) }}>
            <Grid key={`l-${from}-${to}-${gen}`} kind="lines" rows={data.lines} day={to} single={single} onSaved={refreshed} config={config} prepare={prepare} highlight={highlight}
              locked={(row) => !manager && row.stage === 'owner'} rowClass={(row) => (row.id ? `lg-stage-${row.stage}` : '')} />
            {wide && panel && single && <PhotoPanel line={lines.find((l) => l.id === focusId) || null} onClose={() => showPanel(false)}
              onRotate={async (r) => { if (!focusId) return; setLive((x) => ({ ...x, lines: x.lines.map((l) => (l.id === focusId ? { ...l, photoRotate: r } : l)) })); try { await saveRotation({ id: focusId }, r) } catch (err) { toast(err.message) } }} />}
          </div>
          <div className="lg-pair">
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
                {manager && <div className="dc-coh"><dt>Total Commissions</dt><dd>{peso(s.commission)}</dd></div>}
                <div className="dc-sub"><dt>Deposits</dt><dd>{peso(s.deposits)}</dd></div>
                <div className="dc-sub"><dt>Balances</dt><dd>{peso(s.balances)}</dd></div>
              </dl>
              {single && (onlineList.length > 0 || grooming.length > 0) && (
                <div className="lg-lists">
                  {onlineList.length > 0 && <div><h3 className="label">Online</h3><ul>{onlineList.map((l) => <li key={l.id}><span>{l.clientName || l.receiptQr || l.receiptNo}{l.paidWith ? ` · ${PAID_NAME[l.paidWith]}` : ''}</span><span>{peso(l.onlineCents)}</span></li>)}</ul></div>}
                  {grooming.length > 0 && <div><h3 className="label">Grooming</h3><ul>{grooming.map((g) => <li key={g.id}><span>{g.client || '—'} · {g.item}</span><span>{peso(g.amountCents)}</span></li>)}</ul></div>}
                </div>
              )}
              {data.summary && single && <p className="field-hint" style={{ margin: 0 }}>Staff’s typed summary from before: Total Income {peso(data.summary.incomeCents)}, Cash On Hand {peso(data.summary.cashOnHandCents)}.</p>}
              {manager && <p className="field-hint" style={{ margin: 0 }}>Commissions aren’t taken out of the cash; when they’re paid, add them under Expenses (type Vet Commission).</p>}
            </section>
            <div className="stack" style={{ gap: 16 }}>
              <Grid key={`e-${from}-${to}-${gen}`} kind="expenses" rows={data.expenses} day={to} single={single} onSaved={refreshed} />
              <Grid key={`r-${from}-${to}-${gen}`} kind="remits" rows={data.remits} day={to} single={single} onSaved={refreshed} />
            </div>
          </div>
        </div>
      )}
      {open && <Lightbox row={open} onClose={() => setOpen(null)} />}
      {history && <ReceiptHistory row={history} manager={manager} onClose={() => setHistory(null)} onReopened={() => { setHistory(null); reload() }} />}
    </>
  )
}
