// Finances ▸ Ledger (owners and admins): the clinic's cash ledger, typed in like a spreadsheet. One row per
// receipt (Date, Receipt No., Client, Pet, Discount / Notes, Amount, Paid By, Commission), expenses and
// remits in the same style, column totals, and the summary: Total Income - Onlines - Expenses - 1st Remit =
// Cash On Hand, checked against the 2nd Remit. Each cell saves when you leave it. Math: lib/daily-cash.js.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Printer, Trash2 } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { EXPENSE_TYPES, METHODS, summarize } from '../../lib/daily-cash.js'

const peso = (c) => `${Number(c || 0) < 0 ? '−' : ''}₱${(Math.abs(Number(c || 0)) / 100).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const toPesos = (c) => (c == null ? '' : String(Math.round(c) / 100))
const toCents = (v) => { const t = String(v ?? '').replace(/[₱,\s]/g, ''); if (t === '') return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN }
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const shift = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const monday = (day) => { const d = new Date(`${day}T12:00:00Z`); return shift(day, -((d.getUTCDay() + 6) % 7)) }
const RANGES = [
  ['today', 'Today', () => [today(), today()]],
  ['yesterday', 'Yesterday', () => [shift(today(), -1), shift(today(), -1)]],
  ['week', 'This Week', () => [monday(today()), today()]],
  ['month', 'This Month', () => [`${today().slice(0, 8)}01`, today()]],
]

// The three grids: their columns, what a blank row holds, and how a row is sent.
const GRIDS = {
  lines: {
    title: 'Receipts',
    columns: [
      { key: 'day', label: 'Date', type: 'date', width: 150 },
      { key: 'receiptNo', label: 'Receipt No.', width: 110 },
      { key: 'clientName', label: 'Client', width: 180 },
      { key: 'petNames', label: 'Pet', width: 150 },
      { key: 'note', label: 'Discount / Notes', width: 200 },
      { key: 'amountCents', label: 'Amount', type: 'money', total: true, width: 120 },
      { key: 'method', label: 'Cash / Online', type: 'select', options: METHODS.map((m) => [m.key, m.label]), width: 150 },
      { key: 'commissionCents', label: 'Commission', type: 'money', total: true, width: 120 },
    ],
    blank: (day) => ({ day, receiptNo: '', clientName: '', petNames: '', note: '', amountCents: null, method: 'cash', commissionCents: null }),
  },
  expenses: {
    title: 'Expenses',
    columns: [
      { key: 'day', label: 'Date', type: 'date', width: 150 },
      { key: 'category', label: 'Type', type: 'select', options: EXPENSE_TYPES.map((t) => [t, t]), width: 190 },
      { key: 'description', label: 'What For', width: 220 },
      { key: 'amountCents', label: 'Amount', type: 'money', total: true, width: 120 },
    ],
    blank: (day) => ({ day, category: 'Supplies', description: '', amountCents: null }),
  },
  remits: {
    title: 'Remits',
    hint: 'Cash handed over only. Online payments are already taken out under Onlines.',
    columns: [
      { key: 'day', label: 'Date', type: 'date', width: 150 },
      { key: 'kind', label: 'Remit', type: 'select', options: [['first', '1st (3 PM)'], ['second', '2nd (End of Day)']], width: 190 },
      { key: 'amountCents', label: 'Amount', type: 'money', total: true, width: 120 },
      { key: 'remittedBy', label: 'Remitted By', width: 170 },
    ],
    blank: (day) => ({ day, kind: 'first', amountCents: null, remittedBy: '' }),
  },
}
// A blank row only gets saved once something besides its defaults is typed.
const hasContent = (kind, r) => Object.entries(r).some(([k, v]) => !['day', 'method', 'category', 'kind', 'id', 'key'].includes(k) && v !== '' && v != null)

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

// One spreadsheet. Rows live in a ref (the latest values, changed the moment a cell changes) and keep the
// same on-screen key from the first keystroke, so a row being saved for the first time is never redrawn
// (nothing half-typed is lost). Saves run one after another and always send the row as it is now.
let nextKey = 1
const withKey = (r) => ({ ...r, ck: `k${nextKey++}` })
function Grid({ kind, rows, defaultDay, onSaved }) {
  const g = GRIDS[kind]
  const toast = useToast()
  const store = useRef(null)
  const [, redraw] = useState(0)
  const [confirm, setConfirm] = useState(null)
  const saving = useRef(Promise.resolve())
  if (!store.current) store.current = [...rows.map(withKey), withKey(g.blank(defaultDay))]
  const rerender = () => redraw((n) => n + 1)
  useEffect(() => { // a new day picked for the empty row's date
    const last = store.current[store.current.length - 1]
    if (!last.id && !hasContent(kind, last)) { last.day = defaultDay; rerender() }
  }, [defaultDay]) // eslint-disable-line react-hooks/exhaustive-deps

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
          if (!hasContent(kind, row)) return
          const r = await api(`finances/daily/${kind}`, { method: 'POST', body })
          row.id = r.row.id
          if (store.current[store.current.length - 1].ck === ck) store.current.push(withKey(g.blank(row.day))) // a fresh empty row below
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
  return (
    <section className="card lg-card">
      <div className="card-head"><h2>{g.title}</h2><span className="cell-sub">{g.hint ? `${g.hint} ` : ''}{saved.length} row{saved.length === 1 ? '' : 's'} · type in the last row to add one</span></div>
      <div className="lg-scroll">
        <table className="lg-table">
          <colgroup><col style={{ width: 44 }} />{g.columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}<col style={{ width: 44 }} /></colgroup>
          <thead><tr><th className="lg-rownum">#</th>{g.columns.map((c) => <th key={c.key} className={c.type === 'money' ? 'lg-num' : ''}>{c.label}</th>)}<th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {all.map((row, r) => {
              const isNew = !row.id
              return (
                <tr key={row.ck} className={isNew ? 'lg-new' : ''}>
                  <td className="lg-rownum">{isNew ? '+' : r + 1}</td>
                  {g.columns.map((col, c) => (
                    <td key={col.key}><Cell col={col} value={row[col.key]} grid={kind} r={r} c={c} onChange={(v) => set(row.ck, col.key, v)} onCommit={() => save(row.ck)} /></td>
                  ))}
                  <td>{!isNew && <button type="button" className={`icon-btn lg-del ${confirm === row.ck ? 'is-confirm' : ''}`} onClick={() => remove(row)} aria-label={confirm === row.ck ? 'Tap again to remove this row' : `Remove row ${r + 1}`} title={confirm === row.ck ? 'Tap again to remove' : 'Remove Row'}>{confirm === row.ck ? '?' : <Trash2 />}</button>}</td>
                </tr>
              )
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
  const [range, setRange] = useState('today')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const { data, error } = useApi(canManage(staff) ? `finances/daily?from=${from}&to=${to}` : null)
  const [live, setLive] = useState(null) // the grids' rows as saved, for the summary without reloading
  useEffect(() => { if (data) setLive({ lines: data.lines, expenses: data.expenses, remits: data.remits }) }, [data])
  const defaultDay = from === to ? from : to >= today() && from <= today() ? today() : to
  const s = useMemo(() => (live ? summarize(live) : null), [live])
  const head = <PageHead crumbs={[{ label: 'Finances' }, { label: 'Ledger' }]} title="Ledger" intro="The clinic’s cash ledger. Type in the cells like a spreadsheet; each cell saves when you leave it, and the totals add up by themselves." />
  if (!canManage(staff)) return <>{head}<ErrorNote error={new Error('Only an owner or admin can open the Ledger.')} /></>
  const pick = (key) => { const r = RANGES.find((x) => x[0] === key); setRange(key); if (r) { const [a, b] = r[2](); setFrom(a); setTo(b) } }
  // After any save, fetch quietly so the summary and the other grids agree.
  const refreshed = () => api(`finances/daily?from=${from}&to=${to}`).then((d) => setLive({ lines: d.lines, expenses: d.expenses, remits: d.remits })).catch(() => {})
  const onlineMethods = METHODS.filter((m) => m.online && s?.byMethod[m.key])
  return (
    <>
      {head}
      <div className="lg-bar">
        <div className="tabs tab-scroll" role="group" aria-label="Dates to show">
          {RANGES.map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={range === k} onClick={() => pick(k)}>{l}</button>)}
          <button type="button" className="tab" aria-pressed={range === 'custom'} onClick={() => setRange('custom')}>Custom</button>
        </div>
        {range === 'custom' && <>
          <input type="date" className="dc-date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" />
          <span className="cell-sub">to</span>
          <input type="date" className="dc-date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To" />
        </>}
        <strong className="dc-dayname">{from === to ? prettyDay(from) : `${prettyDay(from)} to ${prettyDay(to)}`}</strong>
        <button type="button" className="btn btn-quiet dc-print" onClick={() => window.print()}><Printer aria-hidden /> Print</button>
      </div>
      <ErrorNote error={error} />
      {!data || !live || data.from !== from || data.to !== to ? <PawLoader label="Loading the ledger…" /> : (
        <div className="stack" style={{ gap: 16 }}>
          <Grid key={`l-${from}-${to}`} kind="lines" rows={data.lines} defaultDay={defaultDay} onSaved={refreshed} />
          <section className="card card-pad lg-summary">
            <h2>Summary{from !== to ? ' for These Dates' : ''}</h2>
            <dl>
              <div><dt>Total Income ({s.receipts} receipt{s.receipts === 1 ? '' : 's'})</dt><dd>{peso(s.total)}</dd></div>
              <div><dt>Less Onlines</dt><dd>− {peso(s.onlines)}</dd></div>
              {onlineMethods.map((m) => <div key={m.key} className="dc-sub"><dt>{m.label}</dt><dd>{peso(s.byMethod[m.key])}</dd></div>)}
              <div><dt>Less Expenses</dt><dd>− {peso(s.expenses)}</dd></div>
              <div><dt>Less 1st Remit</dt><dd>− {peso(s.firstRemit)}</dd></div>
              <div className="dc-coh"><dt>Cash On Hand</dt><dd>{peso(s.cashOnHand)}</dd></div>
              {s.cashOnHand < 0 && <div className="lg-off"><dt>The expenses and 1st Remit are more than the cash collected ({peso(s.cash)}). Online payments are already taken out under Onlines: only enter cash handed over as a remit.</dt></div>}
              <div><dt>2nd Remit</dt><dd>{s.hasSecond ? peso(s.secondRemit) : '—'}</dd></div>
              {s.hasSecond && <div className={s.difference === 0 ? 'lg-ok' : 'lg-off'}><dt>{s.difference === 0 ? '✓ Matches Cash On Hand' : s.difference < 0 ? 'Short' : 'Over'}</dt><dd>{s.difference === 0 ? '' : peso(Math.abs(s.difference))}</dd></div>}
              <div className="dc-coh"><dt>Total Commission</dt><dd>{peso(s.commission)}</dd></div>
            </dl>
            <p className="field-hint" style={{ margin: 0 }}>Cash total: {peso(s.cash)}. Commission isn’t taken out of the cash; when it’s paid, add it under Expenses (type Vet Commission).</p>
          </section>
          <div className="lg-pair">
            <Grid key={`e-${from}-${to}`} kind="expenses" rows={data.expenses} defaultDay={defaultDay} onSaved={refreshed} />
            <Grid key={`r-${from}-${to}`} kind="remits" rows={data.remits} defaultDay={defaultDay} onSaved={refreshed} />
          </div>
        </div>
      )}
    </>
  )
}
