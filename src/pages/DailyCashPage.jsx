// Finances ▸ Ledger (owners and admins): the clinic's cash ledger, in the clinic's own sheet layout, typed in like a
// spreadsheet. Receipts: Receipt No. OR | Receipt No. QR | Owner's Name | Pet's Name | Total Per Receipt | Discounts and
// Notes | Online Payments | Deposit | Balance | Total Income | Commissions, with totals at the bottom; then Expenses and
// Remits, and the summary: Total Income - Online Payments - Expenses - 1st Remit = Cash On Hand, checked against the
// 2nd Remit. The date comes from the calendar (one day, or several by dragging). Each cell saves when you leave it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Printer, Trash2 } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { EXPENSE_TYPES, summarize } from '../../lib/daily-cash.js'

const peso = (c) => `${Number(c || 0) < 0 ? '−' : ''}₱${(Math.abs(Number(c || 0)) / 100).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const toPesos = (c) => (c == null ? '' : String(Math.round(c) / 100))
const toCents = (v) => { const t = String(v ?? '').replace(/[₱,\s]/g, ''); if (t === '') return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN }
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const shift = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// The three sheets: their columns, what an empty row holds.
const GRIDS = {
  lines: {
    title: 'Receipts',
    minWidth: 1000,
    columns: [
      { key: 'receiptNo', label: 'Receipt No. OR', width: '8%' },
      { key: 'receiptQr', label: 'Receipt No. QR', width: '8%' },
      { key: 'clientName', label: 'Owner’s Name', width: '12%' },
      { key: 'petNames', label: 'Pet’s Name', width: '10%' },
      { key: 'amountCents', label: 'Total Per Receipt', type: 'money', total: true, width: '9%' },
      { key: 'note', label: 'Discounts and Notes', width: '12%' },
      { key: 'onlineCents', label: 'Online Payments', type: 'money', total: true, width: '9%' },
      { key: 'depositCents', label: 'Deposit', type: 'money', total: true, width: '7%' },
      { key: 'balanceCents', label: 'Balance', type: 'money', total: true, width: '7%' },
      { key: 'incomeCents', label: 'Total Income', type: 'money', total: true, width: '9%' },
      { key: 'commissionCents', label: 'Commissions', type: 'money', total: true, width: '9%' },
    ],
    blank: (day) => ({ day, receiptNo: '', receiptQr: '', clientName: '', petNames: '', amountCents: null, note: '', onlineCents: null, depositCents: null, balanceCents: null, incomeCents: null, commissionCents: null }),
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
const hasContent = (r) => Object.entries(r).some(([k, v]) => !['day', 'category', 'kind', 'id', 'ck'].includes(k) && v !== '' && v != null)

// One calendar: tap a day, or drag across days (mouse or finger) for several.
function RangeCalendar({ from, to, onPick }) {
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

function Cell({ col, value, onChange, onCommit, r, c, grid }) {
  const [text, setText] = useState(col.type === 'money' ? toPesos(value) : value ?? '')
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setText(col.type === 'money' ? toPesos(value) : value ?? '') }, [value, focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const nav = (e) => {
    const move = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!move || (col.type === 'select' && e.key !== 'Enter')) return
    e.preventDefault()
    e.currentTarget.blur()
    requestAnimationFrame(() => document.querySelector(`[data-grid="${grid}"][data-r="${r + move}"][data-c="${c}"]`)?.focus())
  }
  const common = { 'data-grid': grid, 'data-r': r, 'data-c': c, 'aria-label': col.label, onKeyDown: nav, onFocus: () => setFocus(true) }
  if (col.type === 'select') {
    return <select {...common} className="lg-cell" value={value} onChange={(e) => { onChange(e.target.value); onCommit({ [col.key]: e.target.value }) }} onBlur={() => setFocus(false)}>{col.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
  }
  if (col.type === 'date') {
    return <input {...common} type="date" className="lg-cell" value={value || ''} onChange={(e) => e.target.value && onChange(e.target.value)} onBlur={(e) => { setFocus(false); onCommit({ day: e.target.value || value }) }} />
  }
  return (
    <input {...common} className={`lg-cell ${col.type === 'money' ? 'lg-num' : ''}`} inputMode={col.type === 'money' ? 'decimal' : undefined} value={focus || col.type !== 'money' ? text : text === '' ? '' : (toCents(text) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}
      onChange={(e) => setText(e.target.value)} maxLength={col.type === 'money' ? 14 : 300}
      onBlur={() => {
        setFocus(false)
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
function Grid({ kind, rows, day, single, onSaved }) {
  const g = GRIDS[kind]
  const toast = useToast()
  const store = useRef(null)
  const [, redraw] = useState(0)
  const [confirm, setConfirm] = useState(null)
  const saving = useRef(Promise.resolve())
  if (!store.current) store.current = [...rows.map(withKey), ...(single ? [withKey(g.blank(day))] : [])]
  const rerender = () => redraw((n) => n + 1)
  const find = (ck) => store.current.find((x) => x.ck === ck)
  function set(ck, k, v) { const row = find(ck); if (row) { row[k] = v; rerender() } }
  function save(ck) {
    saving.current = saving.current.then(async () => {
      const row = find(ck)
      if (!row) return
      const { ck: _ck, ...body } = row
      try {
        if (row.id) await api(`finances/daily/${kind}/${row.id}`, { method: 'PATCH', body })
        else {
          if (!hasContent(row)) return
          const r = await api(`finances/daily/${kind}`, { method: 'POST', body })
          row.id = r.row.id
          if (store.current[store.current.length - 1].ck === ck) store.current.push(withKey(g.blank(row.day)))
          rerender()
        }
        onSaved()
      } catch (err) { toast(err.message) }
    })
  }
  async function remove(row) {
    if (confirm !== row.ck) { setConfirm(row.ck); setTimeout(() => setConfirm((c) => (c === row.ck ? null : c)), 3000); return }
    try {
      await api(`finances/daily/${kind}/${row.id}`, { method: 'DELETE' })
      store.current = store.current.filter((x) => x.ck !== row.ck)
      setConfirm(null); rerender(); onSaved(); toast('Row removed')
    } catch (err) { toast(err.message) }
  }
  const all = store.current
  const saved = all.filter((r) => r.id)
  const totals = Object.fromEntries(g.columns.filter((c) => c.total).map((c) => [c.key, all.reduce((sum, r) => sum + (r[c.key] || 0), 0)]))
  const span = g.columns.length + 2
  let lastDay = null
  let n = 0
  return (
    <section className="card lg-card">
      <div className="card-head"><h2>{g.title}</h2><span className="cell-sub">{g.hint ? `${g.hint} ` : ''}{saved.length} row{saved.length === 1 ? '' : 's'}{single ? ' · type in the last row to add one' : ' · pick one day to add rows'}</span></div>
      <div className="lg-scroll">
        <table className="lg-table" style={g.minWidth ? { width: '100%', minWidth: g.minWidth } : undefined}>
          <colgroup><col style={{ width: 44 }} />{g.columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}<col style={{ width: 44 }} /></colgroup>
          <thead><tr><th className="lg-rownum">#</th>{g.columns.map((c) => <th key={c.key} className={c.type === 'money' ? 'lg-num' : ''}>{c.label}</th>)}<th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {all.map((row, r) => {
              const isNew = !row.id
              const groupHead = !single && row.day !== lastDay
              if (row.day !== lastDay) n = 0
              lastDay = row.day
              n++
              return [
                groupHead && <tr key={`d-${row.day}`} className="lg-day"><td colSpan={span}>{prettyDay(row.day)}</td></tr>,
                <tr key={row.ck} className={isNew ? 'lg-new' : ''}>
                  <td className="lg-rownum">{isNew ? '+' : n}</td>
                  {g.columns.map((col, c) => (
                    <td key={col.key}><Cell col={col} value={row[col.key]} grid={kind} r={r} c={c} onChange={(v) => set(row.ck, col.key, v)} onCommit={() => save(row.ck)} /></td>
                  ))}
                  <td>{!isNew && <button type="button" className={`icon-btn lg-del ${confirm === row.ck ? 'is-confirm' : ''}`} onClick={() => remove(row)} aria-label={confirm === row.ck ? 'Tap again to remove this row' : `Remove row ${n}`} title={confirm === row.ck ? 'Tap again to remove' : 'Remove Row'}>{confirm === row.ck ? '?' : <Trash2 />}</button>}</td>
                </tr>,
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
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [calOpen, setCalOpen] = useState(false)
  const { data, error } = useApi(canManage(staff) ? `finances/daily?from=${from}&to=${to}` : null)
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
          {calOpen && <div className="rc-pop card"><RangeCalendar from={from} to={to} onPick={pick} /></div>}
        </div>
        {!(single && from === today()) && <button type="button" className="text-btn" onClick={() => pick(today(), today())}>Today</button>}
        <button type="button" className="btn btn-quiet dc-print" onClick={() => window.print()}><Printer aria-hidden /> Print</button>
      </div>
      <ErrorNote error={error} />
      {!data || !live || data.from !== from || data.to !== to ? <PawLoader label="Loading the ledger…" /> : (
        <div className="stack" style={{ gap: 16 }}>
          <Grid key={`l-${from}-${to}`} kind="lines" rows={data.lines} day={to} single={single} onSaved={refreshed} />
          <section className="card card-pad lg-summary">
            <h2>Summary{single ? '' : ' for These Dates'}</h2>
            <dl>
              <div><dt>Total Income ({s.receipts} receipt{s.receipts === 1 ? '' : 's'})</dt><dd>{peso(s.income)}</dd></div>
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
            <Grid key={`e-${from}-${to}`} kind="expenses" rows={data.expenses} day={to} single={single} onSaved={refreshed} />
            <Grid key={`r-${from}-${to}`} kind="remits" rows={data.remits} day={to} single={single} onSaved={refreshed} />
          </div>
        </div>
      )}
    </>
  )
}
