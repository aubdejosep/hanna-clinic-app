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
      <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)} title={`Remove every row of ${word} in ${book === 'owner' ? 'your Ledger' : 'staff’s Receipts'}`}><Eraser aria-hidden /> Clear This Day</button>
      {open && (
        <div className="bal-alert-backdrop" onClick={() => !busy && setOpen(false)}>
          <form className="card clear-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (text.trim().toLowerCase() === word.toLowerCase()) clear() }}>
            <h2 id="clear-title">Clear {word} from {book === 'owner' ? 'your Ledger' : 'staff’s Receipts'}?</h2>
            <p>This removes {what} for {word}{book === 'staff' ? ' (photos stay in storage)' : ''}. {book === 'owner' ? 'Staff’s Receipts aren’t touched.' : 'Your Ledger isn’t touched.'}</p>
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

export function ClearedBanner({ day, book, cleared, onDone }) {
  const toast = useToast()
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!cleared) return null
  async function restore() {
    if (!ask) { setAsk(true); setTimeout(() => setAsk(false), 4000); return }
    setBusy(true)
    try { const r = await api('finances/daily/restore', { method: 'POST', body: { day, book, tag: cleared.tag } }); toast(`${short(day)} restored: ${n(r.restored, 'row')} back`); onDone() } catch (err) { toast(err.message) }
    setBusy(false); setAsk(false)
  }
  const about = `${short(day)} was cleared by ${cleared.by} on ${when(cleared.at)}${cleared.receipts || cleared.expenses ? ` (${[cleared.receipts && n(cleared.receipts, 'receipt'), cleared.expenses && n(cleared.expenses, 'expense')].filter(Boolean).join(', ')})` : ''}. Restore Day puts those rows back; anything typed since is kept.`
  return (
    <button type="button" className={`btn btn-quiet ${ask ? 'is-confirm' : ''}`} onClick={restore} disabled={busy} title={about} aria-label={ask ? 'Tap again to restore the cleared rows' : about}>
      <RotateCcw aria-hidden /> {busy ? 'Restoring…' : ask ? 'Tap Again to Restore' : 'Restore Day'}
    </button>
  )
}
