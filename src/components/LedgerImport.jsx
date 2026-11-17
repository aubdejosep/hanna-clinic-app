// Finances ▸ Ledger ▸ Import File: an Excel file in the Ledger template's layout (Receipts, Expenses, Remits sheets),
// typed by hand or made by Claude from the receipt photos. Shows what will happen to every row first (add, skip
// because it's already in the Ledger, or a problem) and each day's totals; nothing is saved until Import.
// Recent Imports lists the last uploads with Undo Import, which takes out only the rows that upload added.
import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Undo2, X } from 'lucide-react'
import { ErrorNote, useToast } from './ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { readXlsx } from '../lib/xlsx.js'
import { readLedgerSheets } from '../../lib/ledger-import.js'
import { prettyDay } from '../lib/format.js'

const peso = (c) => (c == null ? '' : `${c < 0 ? '−' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`)
const STATUS = { add: ['Add', 'badge'], skip: ['Skip', 'badge badge-soft'], error: ['Problem', 'badge badge-warn'] }
const KINDS = {
  lines: { title: 'Receipts', cols: [['receiptNo', 'OR'], ['receiptQr', 'QR'], ['clientName', 'Owner'], ['petNames', 'Pet'], ['amountCents', 'Total', 1], ['onlineCents', 'Online', 1], ['incomeCents', 'Income', 1], ['note', 'Notes']] },
  expenses: { title: 'Expenses', cols: [['category', 'Type'], ['description', 'What For'], ['amountCents', 'Amount', 1]] },
  remits: { title: 'Remits', cols: [['kind', 'Remit'], ['amountCents', 'Amount', 1], ['remittedBy', 'Remitted By']] },
}
const show = (k, v) => (k === 'kind' ? (v === 'second' ? '2nd' : '1st') : k.endsWith('Cents') ? peso(v) : v)

export default function LedgerImport({ fallbackDay, onClose, onDone }) {
  const toast = useToast()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [rows, setRows] = useState(null) // what was read from the file, sent again on Import
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  async function choose(f) {
    if (!f) return
    setFile(f); setResult(null); setRows(null); setError(null); setBusy('read')
    try {
      if (!/\.xlsx$/i.test(f.name)) throw new Error('Choose an Excel file (.xlsx). In Google Sheets: File ▸ Download ▸ Microsoft Excel.')
      const read = readLedgerSheets(await readXlsx(f), fallbackDay)
      if (read.problems.length && !read.lines.length && !read.expenses.length && !read.remits.length) throw new Error(read.problems.join(' '))
      const body = { file: f.name, lines: read.lines, expenses: read.expenses, remits: read.remits }
      setRows({ ...body, problems: read.problems })
      setResult(await api('finances/daily/import', { method: 'POST', body }))
    } catch (err) { setError(err) }
    setBusy(null)
  }
  async function commit() {
    setBusy('import'); setError(null)
    try {
      const { problems, ...body } = rows
      const r = await api('finances/daily/import', { method: 'POST', body: { ...body, commit: true } })
      toast(`Imported ${r.imported} row${r.imported === 1 ? '' : 's'}. To take them out again: Import File ▸ Undo Import.`)
      onDone(r.summary.days.map((d) => d.day))
    } catch (err) { setError(err); setBusy(null) }
  }

  const s = result?.summary
  return (
    <section className="card card-pad stack li-panel" aria-labelledby="li-title">
      <div className="li-head">
        <div>
          <h2 id="li-title">Import From a File</h2>
          <p className="field-hint">An Excel file (.xlsx) in the Ledger template’s layout: Receipts, Expenses and Remits sheets. You’ll see every row before anything is saved, and receipts already in the Ledger are skipped.</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close Import" title="Close"><X /></button>
      </div>
      <div className="inline-row">
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { choose(e.target.files[0]); e.target.value = '' }} />
        <button type="button" className="btn" onClick={() => input.current.click()} disabled={!!busy}><FileSpreadsheet aria-hidden /> {file ? 'Choose Another File' : 'Choose File'}</button>
        <a className="btn btn-quiet" href="/ledger-template.xlsx" download="Hanna Ledger Template.xlsx"><Download aria-hidden /> Download Template</a>
        {file && <span className="field-hint">{file.name}</span>}
      </div>
      {busy === 'read' && <p className="field-hint">Reading the file…</p>}
      <ErrorNote error={error} />
      {rows?.problems?.length > 0 && <div className="lg-off">{rows.problems.join(' ')}</div>}
      {s && (
        <>
          <p className="li-counts">
            <span className="badge">{s.add} to add</span>
            {s.skip > 0 && <span className="badge badge-soft">{s.skip} already in the Ledger</span>}
            {s.error > 0 && <span className="badge badge-warn">{s.error} with a problem (not imported)</span>}
          </p>
          {s.days.length > 0 && (
            <div className="lg-scroll">
              <table className="li-table">
                <caption className="field-hint">Totals of the rows being added. Check them against the paper summary.</caption>
                <thead><tr><th>Date</th><th className="lg-num">Receipts</th><th className="lg-num">Total Income</th><th className="lg-num">Online</th><th className="lg-num">Expenses</th><th className="lg-num">1st Remit</th><th className="lg-num">Cash On Hand</th><th className="lg-num">2nd Remit</th></tr></thead>
                <tbody>
                  {s.days.map((d) => (
                    <tr key={d.day}>
                      <td>{prettyDay(d.day)}</td><td className="lg-num">{d.receipts}</td><td className="lg-num">{peso(d.income)}</td><td className="lg-num">{peso(d.online)}</td>
                      <td className="lg-num">{peso(d.expenses)}</td><td className="lg-num">{peso(d.first)}</td>
                      <td className="lg-num"><strong>{peso(d.income - d.online - d.expenses - d.first)}</strong></td><td className="lg-num">{d.second ? peso(d.second) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Object.entries(KINDS).map(([kind, k]) => result.plan[kind].length > 0 && (
            <div key={kind} className="lg-scroll">
              <table className="li-table">
                <caption><strong>{k.title}</strong> · {result.plan[kind].length} row{result.plan[kind].length === 1 ? '' : 's'}</caption>
                <thead><tr><th>Row</th><th>Date</th>{k.cols.map(([key, label, num]) => <th key={key} className={num ? 'lg-num' : ''}>{label}</th>)}<th /></tr></thead>
                <tbody>
                  {result.plan[kind].map((p, i) => (
                    <tr key={i} className={`li-${p.status}`}>
                      <td>{p.line}</td>
                      <td>{p.day ? prettyDay(p.day) : '—'}</td>
                      {k.cols.map(([key, , num]) => <td key={key} className={num ? 'lg-num' : ''}>{show(key, p.row[key])}</td>)}
                      <td className="li-why">
                        <span className={STATUS[p.status][1]}>{STATUS[p.status][0]}</span>
                        {p.reason && <span>{p.reason}</span>}
                        {p.warnings.map((w) => <span key={w} className="li-warn">{w}</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="inline-row">
            <button type="button" className="btn" onClick={commit} disabled={!s.add || !!busy}>{busy === 'import' ? 'Importing…' : `Import ${s.add} Row${s.add === 1 ? '' : 's'}`}</button>
            <button type="button" className="btn btn-quiet" onClick={onClose} disabled={!!busy}>Cancel</button>
          </div>
        </>
      )}
      {!s && <RecentImports onUndone={onDone} />}
    </section>
  )
}

const when = (iso) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

function RecentImports({ onUndone }) {
  const toast = useToast()
  const { data, error, reload } = useApi('finances/daily/imports')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(null)
  async function undo(imp) {
    if (confirm !== imp.id) { setConfirm(imp.id); setTimeout(() => setConfirm((c) => (c === imp.id ? null : c)), 4000); return }
    setBusy(imp.id)
    try {
      const r = await api(`finances/daily/imports/${imp.id}/undo`, { method: 'POST' })
      toast(`Import undone: ${plural(r.removed, 'row')} taken out`)
      onUndone(r.days)
    } catch (err) { toast(err.message); reload() }
    setBusy(null); setConfirm(null)
  }
  if (error) return <ErrorNote error={error} />
  if (!data || !data.imports.length) return null
  return (
    <div className="li-recent">
      <h3 className="label">Recent Imports</h3>
      <ul>
        {data.imports.map((imp) => {
          const days = imp.days.length > 1 ? `${prettyDay(imp.days[0])} to ${prettyDay(imp.days[imp.days.length - 1])}` : imp.days[0] ? prettyDay(imp.days[0]) : ''
          const parts = [imp.receipts && plural(imp.receipts, 'receipt'), imp.expenses && plural(imp.expenses, 'expense'), imp.remits && plural(imp.remits, 'remit')].filter(Boolean).join(', ')
          return (
            <li key={imp.id}>
              <div>
                <strong>{days}</strong> · {parts || 'no rows'}
                <span className="cell-sub">{imp.file || 'File'} · {imp.createdBy} · {when(imp.createdAt)}</span>
                {imp.undoneAt && <span className="cell-sub">Undone by {imp.undoneBy} · {when(imp.undoneAt)}</span>}
                {!imp.undoneAt && imp.editedRows > 0 && <span className="cell-sub">{plural(imp.editedRows, 'row')} changed since: Undo takes {imp.editedRows === 1 ? 'it' : 'them'} out too.</span>}
              </div>
              {imp.undoneAt ? <span className="badge badge-soft">Undone</span> : (
                <button type="button" className={`btn btn-quiet ${confirm === imp.id ? 'is-confirm' : ''}`} onClick={() => undo(imp)} disabled={!!busy || !imp.leftRows}
                  title={imp.leftRows ? `Takes out the ${plural(imp.leftRows, 'row')} this import added; rows typed by hand stay` : 'Its rows were already removed'}>
                  <Undo2 aria-hidden /> {busy === imp.id ? 'Undoing…' : confirm === imp.id ? `Tap Again to Remove ${plural(imp.leftRows, 'Row')}` : 'Undo Import'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="field-hint">Undo takes out only the rows that import added (they’re kept in the records, not erased). To put them back, import the same file again.</p>
    </div>
  )
}
