// Clear This Day (owners and admins), on Finances ▸ Ledger (your record) and Finances ▸ Receipts (staff's): marks
// every row of that day in that record removed, after typing the date. Nothing is erased; the Restore Day button
// beside it (who cleared it and when on hover) puts exactly those rows back.
import { useEffect, useRef, useState } from 'react'
import { Eraser, RotateCcw } from 'lucide-react'
import { ErrorNote, useToast } from './ui.jsx'
import { api } from '../lib/api.js'

const short = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const when = (iso) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`
const typed = (l) => l.receiptNo || l.receiptQr || l.clientName || l.amountCents || l.incomeCents || l.items?.length || l.photo

export function ClearDayButton({ day, book, data, onDone }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    setText(''); setError(null); requestAnimationFrame(() => input.current?.focus())
    const k = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  const word = short(day)
  const what = [n(data.lines.filter(typed).length, 'receipt'), n(data.expenses.length, 'expense'),
    book === 'owner' ? n(data.remits.length, 'remit') : data.summary ? 'the typed summary' : null].filter(Boolean).join(', ')
  async function clear() {
    setBusy(true); setError(null)
    try {
      await api('finances/daily/clear', { method: 'POST', body: { day, book, confirm: text } })
      toast(`${word} cleared. Restore Day puts it back.`)
      setOpen(false); onDone()
    } catch (err) { setError(err) }
    setBusy(false)
  }
  return (
    <>
      <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)} title={`Remove every row of ${word} from the Ledger`}><Eraser aria-hidden /> Clear This Day</button>
      {open && (
        <div className="bal-alert-backdrop" onClick={() => !busy && setOpen(false)}>
          <form className="card clear-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (text.trim().toLowerCase() === word.toLowerCase()) clear() }}>
            <h2 id="clear-title">Clear {word} from the Ledger?</h2>
            <p>This removes {what} for {word} (photos stay in storage).</p>
            <p className="field-hint" style={{ margin: 0 }}>Rows are marked removed, not erased, and <strong>Restore Day</strong> puts them back.</p>
            <label className="tfp-field"><span>Type {word} to confirm</span><input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={word} /></label>
            <ErrorNote error={error} />
            <div className="inline-row">
              <button type="submit" className="btn" disabled={busy || text.trim().toLowerCase() !== word.toLowerCase()}>{busy ? 'Clearing…' : `Clear ${word}`}</button>
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

const peso = (c) => `₱${((c || 0) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`

// Restore Day: a button in the top bar (who cleared the day and when, on hover). It opens a small window listing
// what will come back, with the Restore button there.
export function ClearedBanner({ day, book, cleared, onDone }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!open || !cleared) return undefined
    setList(null); setError(null)
    api('finances/daily/restore', { method: 'POST', body: { day, book, tag: cleared.tag, preview: true } }).then(setList).catch(setError)
    const k = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, day, book, cleared])
  if (!cleared) return null
  const about = `${short(day)} was cleared by ${cleared.by} on ${when(cleared.at)}.`
  async function restore() {
    setBusy(true); setError(null)
    try { const r = await api('finances/daily/restore', { method: 'POST', body: { day, book, tag: cleared.tag } }); toast(`${short(day)} restored: ${n(r.restored, 'row')} back`); setOpen(false); onDone() } catch (err) { setError(err) }
    setBusy(false)
  }
  const total = list ? list.receipts.length + list.expenses.length + list.remits.length + (list.summary?.kept ? 1 : 0) : 0
  const again = list ? list.receipts.filter((r) => r.again).length : 0
  return (
    <>
      <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)} title={`${about} Click to see what Restore Day brings back.`}><RotateCcw aria-hidden /> Restore Day</button>
      {open && (
        <div className="bal-alert-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="card clear-dialog restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="restore-title">Restore {short(day)} in the Ledger?</h2>
            <p className="field-hint" style={{ margin: 0 }}>{about} Anything typed since stays as it is.</p>
            {!list && !error && <p className="field-hint" style={{ margin: 0 }}>Loading what was cleared…</p>}
            {list && (
              <div className="restore-list">
                {list.receipts.length > 0 && (
                  <section>
                    <h3 className="label">{n(list.receipts.length, 'Receipt')} · {peso(list.receipts.reduce((t, r) => t + (r.amountCents || 0), 0))}</h3>
                    <ul>
                      {list.receipts.map((r, i) => (
                        <li key={i}>
                          <span>{r.receiptQr ? `QR ${r.receiptQr}` : r.receiptNo ? `OR ${r.receiptNo}` : 'No receipt no.'}{r.client ? ` · ${r.client}` : ''}{r.items ? ` · ${n(r.items, 'item')}` : ''}{r.again && <span className="li-warn">typed again since</span>}</span>
                          <strong>{peso(r.amountCents)}</strong>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {list.expenses.length > 0 && (
                  <section>
                    <h3 className="label">{n(list.expenses.length, 'Expense')}</h3>
                    <ul>{list.expenses.map((e, i) => <li key={i}><span>{e.description || e.category}</span><strong>{peso(e.amountCents)}</strong></li>)}</ul>
                  </section>
                )}
                {list.remits.length > 0 && (
                  <section>
                    <h3 className="label">Remits</h3>
                    <ul>{list.remits.map((r, i) => <li key={i}><span>{r.kind === 'second' ? '2nd Remit' : '1st Remit'}</span><strong>{peso(r.amountCents)}</strong></li>)}</ul>
                  </section>
                )}
                {list.summary && (
                  <p className={list.summary.kept ? 'field-hint' : 'tfp-warn'} style={{ margin: 0 }}>
                    {list.summary.kept ? `Staff’s typed summary comes back too (Total Income ${peso(list.summary.incomeCents)}).` : 'Staff typed a new summary since, so the old one stays cleared.'}
                  </p>
                )}
                {again > 0 && <p className="tfp-warn" style={{ margin: 0 }}>{n(again, 'receipt')} {again === 1 ? 'was' : 'were'} typed again since the clear: restoring shows {again === 1 ? 'it' : 'them'} twice. Remove the extra row afterwards.</p>}
                {!total && <p className="field-hint" style={{ margin: 0 }}>Nothing left to restore.</p>}
              </div>
            )}
            <ErrorNote error={error} />
            <div className="inline-row">
              <button type="button" className="btn" onClick={restore} disabled={busy || !total}><RotateCcw aria-hidden /> {busy ? 'Restoring…' : `Restore ${n(total, 'Row')}`}</button>
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
