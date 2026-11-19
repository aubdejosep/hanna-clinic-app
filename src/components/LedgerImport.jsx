// Finances ▸ Ledger ▸ Import File: an Excel file in the Ledger template's layout (Receipts, Expenses, Remits sheets),
// typed by hand or made by Claude from the receipt photos. Shows what will happen to every row first (add, skip
// because it's already in the Ledger, or a problem) and each day's totals; nothing is saved until Import.
// Recent Imports lists the last uploads with Undo Import, which takes out only the rows that upload added.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Images, Undo2, X } from 'lucide-react'
import { PhotoViewer, photoSrc } from './ReceiptTyping.jsx'
import { ErrorNote, useToast } from './ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { readXlsx } from '../lib/xlsx.js'
import { readLedgerSheets } from '../../lib/ledger-import.js'
import { prettyDay } from '../lib/format.js'

const peso = (c) => (c == null ? '' : `${c < 0 ? '−' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`)
const STATUS = { add: ['Add', 'badge'], skip: ['Skip', 'badge badge-soft'], error: ['Problem', 'badge badge-warn'] }
const KINDS = {
  lines: { title: 'Receipts', cols: [['receiptNo', 'OR'], ['receiptQr', 'QR'], ['clientName', 'Owner'], ['petNames', 'Pet'], ['items', 'Items'], ['amountCents', 'Total', 1], ['discountCents', 'Disc.', 1], ['onlineCents', 'Online', 1], ['incomeCents', 'Income', 1], ['note', 'Notes']] },
  expenses: { title: 'Expenses', cols: [['category', 'Type'], ['description', 'What For'], ['amountCents', 'Amount', 1]] },
  remits: { title: 'Remits', cols: [['kind', 'Remit'], ['amountCents', 'Amount', 1], ['remittedBy', 'Remitted By']] },
}
const show = (k, v) => (k === 'kind' ? (v === 'second' ? '2nd' : '1st') : k === 'items' ? (v || []).map((i) => `${i.item}${i.amountCents != null ? ` ${peso(i.amountCents)}` : ''}`).join(', ') : k.endsWith('Cents') ? peso(v) : v)

// copyDay: Copy from Staff instead of a file: staff's Receipts for that day, shown the same way before copying.
const PAID_LABEL = { cash: 'Cash', gcash: 'GCash', bank: 'Bank Transfer', maribank: 'MariBank', card: 'Card', qrph: 'QRPH', none: 'Not Counted' }

// Copy from Staff ▸ Review with Photos: each receipt's photo big on the left, staff's entry on the right; approve it
// (Looks Right) or Leave Out, then the next one. Only approved receipts are copied.
function ReviewPhotos({ plans, start, out, setOut, onClose }) {
  const [at, setAt] = useState(start)
  const [rot, setRot] = useState({})
  const p = plans[at]
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setAt((x) => Math.min(plans.length - 1, x + 1))
      else if (e.key === 'ArrowLeft') setAt((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, plans.length])
  const left = out.size
  const r = p.row
  const decide = (keep) => {
    setOut((o) => { const n = new Set(o); if (keep) n.delete(p.staffId); else n.add(p.staffId); return n })
    if (at < plans.length - 1) setAt(at + 1)
    else onClose()
  }
  const line = { id: p.staffId, photo: p.photo, photoRotate: rot[p.staffId] ?? p.photoRotate }
  const kept = !out.has(p.staffId)
  const item = (label, v) => v ? <div className="rv-line"><span>{label}</span><strong>{v}</strong></div> : null
  return (
    <div className="tfp" role="dialog" aria-modal="true" aria-labelledby="rv-title">
      <div className="tfp-bar">
        <strong id="rv-title">Review with Photos</strong>
        <span className="tfp-progress"><span style={{ width: `${((at + 1) / plans.length) * 100}%` }} /></span>
        <span className="cell-sub">Receipt {at + 1} of {plans.length}{left ? ` · ${left} left out` : ''}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Back to the list" title="Back to the List (Esc)"><X /></button>
      </div>
      <div className="tfp-body">
        <PhotoViewer line={line} onRotate={(v) => setRot((x) => ({ ...x, [p.staffId]: v }))} />
        <div className="tfp-form rv-entry">
          <div className="rv-head">
            <h2>{r.receiptQr ? `QR ${r.receiptQr}` : r.receiptNo ? `OR ${r.receiptNo}` : 'No receipt number'}</h2>
            <span className={kept ? 'badge' : 'badge badge-soft'}>{kept ? 'Will Be Copied' : 'Left Out'}</span>
          </div>
          <p className="field-hint" style={{ margin: 0 }}>What staff typed. Check it against the photo.</p>
          <div className="rv-card">
            {item('Owner', r.clientName)}{item('Pet', r.petNames)}
            {r.items?.length > 0 && (
              <div className="rv-items">
                <span className="tfp-label">Items</span>
                {r.items.map((i, n) => <div key={n} className="rv-line"><span>{i.item || '—'}</span><strong>{peso(i.amountCents)}</strong></div>)}
              </div>
            )}
            {item('Total Per Receipt', r.amountCents != null ? peso(r.amountCents) : null)}
            {item('Discounts', r.discountCents ? peso(r.discountCents) : null)}
            {item('Paid With', PAID_LABEL[r.paidWith] || null)}
            {item('Online', r.onlineCents ? peso(r.onlineCents) : null)}
            {item('Total Income', r.incomeCents != null ? peso(r.incomeCents) : 'Not counted')}
            {item('Notes', r.note)}
          </div>
          {p.warnings.length > 0 && p.warnings.map((w) => <p key={w} className="tfp-warn">{w}</p>)}
          {!p.photo && <p className="tfp-warn">Staff didn’t attach a photo to this receipt.</p>}
          <div className="tfp-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setAt(at - 1)} disabled={at === 0}><ChevronLeft aria-hidden /> Previous</button>
            <button type="button" className="btn" onClick={() => decide(true)}><Check aria-hidden /> Looks Right{at < plans.length - 1 ? ', Next' : ''}</button>
            <button type="button" className="btn btn-quiet" onClick={() => decide(false)}><X aria-hidden /> Leave Out</button>
          </div>
          <p className="field-hint" style={{ margin: 0 }}>Left out receipts aren’t copied; fix them on the Receipts page (or in your Ledger) and copy again. Arrow keys move between receipts; Esc goes back to the list.</p>
        </div>
      </div>
    </div>
  )
}

export default function LedgerImport({ fallbackDay, onClose, onDone, copyDay }) {
  const toast = useToast()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [rows, setRows] = useState(null) // what was read from the file, sent again on Import
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [leaveOut, setLeaveOut] = useState(() => new Set()) // Copy from Staff: receipts left out while reviewing
  const [review, setReview] = useState(null) // index into the receipts being added, while Review with Photos is open
  useEffect(() => {
    if (!copyDay) return
    setBusy('read'); setError(null)
    api('finances/daily/copy', { method: 'POST', body: { day: copyDay } })
      .then((r) => { setResult(r); setRows({ day: copyDay }) }).catch(setError).finally(() => setBusy(null))
  }, [copyDay])

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
      const r = await api(copyDay ? 'finances/daily/copy' : 'finances/daily/import', { method: 'POST', body: { ...body, commit: true, ...(copyDay ? { leaveOut: [...leaveOut] } : {}) } })
      toast(`${copyDay ? 'Copied' : 'Imported'} ${r.imported} row${r.imported === 1 ? '' : 's'}. To take them out again: Import File ▸ Undo Import.`)
      onDone(r.summary.days.map((d) => d.day))
    } catch (err) { setError(err); setBusy(null) }
  }

  const s = result?.summary
  const toAdd = copyDay && result ? result.plan.lines.filter((p) => p.status === 'add' && p.staffId) : []
  // The day totals without the receipts left out while reviewing.
  const days = !s ? [] : s.days.map((d) => {
    const outs = toAdd.filter((p) => leaveOut.has(p.staffId) && p.day === d.day)
    const net = (p) => (p.row.incomeCents != null ? p.row.incomeCents - (p.row.discountCents || 0) : 0)
    return { ...d, receipts: d.receipts - outs.length, income: d.income - outs.reduce((t, p) => t + net(p), 0), online: d.online - outs.reduce((t, p) => t + (p.row.onlineCents || 0), 0) }
  })
  const adding = s ? s.add - (copyDay ? toAdd.filter((p) => leaveOut.has(p.staffId)).length : 0) : 0
  return (
    <section className="card card-pad stack li-panel" aria-labelledby="li-title">
      <div className="li-head">
        <div>
          <h2 id="li-title">{copyDay ? 'Copy from Staff' : 'Import From a File'}</h2>
          <p className="field-hint">{copyDay
            ? `Staff’s receipts (with their items) and expenses for ${prettyDay(copyDay)}, into your Ledger. Receipts already in your Ledger are skipped. Staff’s summary and photos stay on their page.`
            : 'An Excel file (.xlsx) in the Ledger template’s layout: Receipts, Items, Expenses and Remits sheets. You’ll see every row before anything is saved, and receipts already in the Ledger are skipped.'}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close Import" title="Close"><X /></button>
      </div>
      {!copyDay && <div className="inline-row">
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { choose(e.target.files[0]); e.target.value = '' }} />
        <button type="button" className="btn" onClick={() => input.current.click()} disabled={!!busy}><FileSpreadsheet aria-hidden /> {file ? 'Choose Another File' : 'Choose File'}</button>
        <a className="btn btn-quiet" href="/ledger-template.xlsx" download="Hanna Ledger Template.xlsx"><Download aria-hidden /> Download Template</a>
        {file && <span className="field-hint">{file.name}</span>}
      </div>}
      {busy === 'read' && <p className="field-hint">{copyDay ? 'Loading staff’s receipts…' : 'Reading the file…'}</p>}
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
                <thead><tr><th>Date</th><th className="lg-num">Receipts</th><th className="lg-num">Net Income</th><th className="lg-num">Online</th><th className="lg-num">Expenses</th><th className="lg-num">1st Remit</th><th className="lg-num">Cash On Hand</th><th className="lg-num">2nd Remit</th></tr></thead>
                <tbody>
                  {days.map((d) => (
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
          {copyDay && toAdd.length > 0 && (
            <div className="rv-start">
              <button type="button" className="btn" onClick={() => setReview(0)}><Images aria-hidden /> Review with Photos</button>
              <span className="field-hint">Each receipt’s photo next to what staff typed. {leaveOut.size ? `${leaveOut.size} left out so far.` : 'Approve each one, or leave it out.'}</span>
            </div>
          )}
          {Object.entries(KINDS).map(([kind, k]) => result.plan[kind].length > 0 && (
            <div key={kind} className="lg-scroll">
              <table className="li-table">
                <caption><strong>{k.title}</strong> · {result.plan[kind].length} row{result.plan[kind].length === 1 ? '' : 's'}</caption>
                <thead><tr>{copyDay && kind === 'lines' && <th>Photo</th>}<th>Row</th><th>Date</th>{k.cols.map(([key, label, num]) => <th key={key} className={num ? 'lg-num' : ''}>{label}</th>)}<th /></tr></thead>
                <tbody>
                  {result.plan[kind].map((p, i) => (
                    <tr key={i} className={`li-${p.status} ${p.staffId && leaveOut.has(p.staffId) ? 'li-skip' : ''}`}>
                      {copyDay && kind === 'lines' && (
                        <td>{p.photo
                          ? <button type="button" className="rc-thumb" onClick={() => p.status === 'add' ? setReview(toAdd.indexOf(p)) : window.open(photoSrc({ id: p.staffId }), '_blank')} title="Review with the photo"><img src={photoSrc({ id: p.staffId })} alt="" loading="lazy" style={p.photoRotate ? { transform: `rotate(${p.photoRotate}deg)` } : undefined} /></button>
                          : <span className="cell-sub">No photo</span>}</td>
                      )}
                      <td>{p.line}</td>
                      <td>{p.day ? prettyDay(p.day) : '—'}</td>
                      {k.cols.map(([key, , num]) => <td key={key} className={num ? 'lg-num' : ''}>{show(key, p.row[key])}</td>)}
                      <td className="li-why">
                        {p.staffId && leaveOut.has(p.staffId)
                          ? <><span className="badge badge-soft">Left Out</span><button type="button" className="text-btn" onClick={() => setLeaveOut((o) => { const n = new Set(o); n.delete(p.staffId); return n })}>Include</button></>
                          : <span className={STATUS[p.status][1]}>{STATUS[p.status][0]}</span>}
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
            <button type="button" className="btn" onClick={commit} disabled={!adding || !!busy}>{busy === 'import' ? (copyDay ? 'Copying…' : 'Importing…') : `${copyDay ? 'Copy' : 'Import'} ${adding} Row${adding === 1 ? '' : 's'}`}</button>
            <button type="button" className="btn btn-quiet" onClick={onClose} disabled={!!busy}>Cancel</button>
          </div>
        </>
      )}
      {!s && <RecentImports onUndone={onDone} />}
      {review !== null && toAdd.length > 0 && <ReviewPhotos plans={toAdd} start={Math.max(0, review)} out={leaveOut} setOut={setLeaveOut} onClose={() => setReview(null)} />}
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
  if (error) return <div className="li-recent"><h3 className="label">Recent Imports</h3><ErrorNote error={error} /></div>
  if (!data) return null
  if (!data.imports.length) {
    return (
      <div className="li-recent">
        <h3 className="label">Recent Imports</h3>
        <p className="field-hint">No files imported yet. Each file you import shows here with an Undo Import button, which takes out only the rows it added.</p>
      </div>
    )
  }
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
