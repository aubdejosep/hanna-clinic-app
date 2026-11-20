// Finances ▸ Master List (every staff member): every receipt ever logged, as cards in receipt-number order (quotation
// slips, then service invoices), 5 per row on a computer and 2 on a phone. Tap a card for the receipt: its photo big
// (zoom and pan, not saved) and its details. Read only: changes are made on Receipts or the Ledger.
// Owners and admins see the Ledger's and staff's rows combined per receipt number; staff see their own Receipts.
// Server: GET /api/finances/daily/master.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ReceiptText, Search, X } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useDebounced } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'
import { canManage, useStaff } from '../lib/staff.js'
import { PhotoViewer } from '../components/ReceiptTyping.jsx'
import { peso, shift, today } from './DailyCashPage.jsx'

const PAID = { cash: 'Cash', gcash: 'GCash', bank: 'Bank Transfer', maribank: 'MariBank', card: 'Card', qrph: 'QRPH', none: 'Not Counted' }
const monday = (d) => shift(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7))
function range(key) {
  const t = today()
  const y = t.slice(0, 4)
  const lastMonthEnd = shift(`${t.slice(0, 8)}01`, -1)
  return {
    all: [null, null], today: [t, t], week: [monday(t), t], lastweek: [shift(monday(t), -7), shift(monday(t), -1)],
    month: [`${t.slice(0, 8)}01`, t], lastmonth: [`${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd], year: [`${y}-01-01`, t],
  }[key]
}
const RANGES = [['all', 'All Time'], ['today', 'Today'], ['week', 'This Week'], ['lastweek', 'Last Week'], ['month', 'This Month'], ['lastmonth', 'Last Month'], ['year', 'This Year']]
const KEY = 'master-list-view'
const saved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }

function ReceiptView({ r, onClose, manager }) {
  const [rot, setRot] = useState(r.photo?.rotate || 0)
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const itemsSum = r.items.reduce((n, i) => n + (i.amountCents || 0), 0)
  return (
    <div className="bal-alert-backdrop" onClick={onClose}>
      <div className="card ml-view" role="dialog" aria-modal="true" aria-labelledby="ml-title" onClick={(e) => e.stopPropagation()}>
        <div className="ml-photo">
          {r.photo ? <PhotoViewer line={{ id: r.photo.id, photo: true, photoRotate: rot }} onRotate={setRot} />
            : <div className="ml-nophoto"><ReceiptText aria-hidden /><span>No photo of this receipt</span></div>}
        </div>
        <div className="ml-details">
          <div className="pp-head">
            <h2 id="ml-title">{r.kind} {r.number}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)"><X /></button>
          </div>
          <p className="cell-sub" style={{ margin: 0 }}>{prettyDay(r.day)}{r.by ? ` · ${r.by}` : ''}{manager ? ` · ${r.books.map((b) => (b === 'owner' ? 'Ledger' : 'Receipts')).join(' and ')}` : ''}</p>
          <dl className="ml-dl">
            <div><dt>Owner</dt><dd>{r.clientName || '—'}</dd></div>
            <div><dt>Pet</dt><dd>{r.petNames || '—'}</dd></div>
          </dl>
          {r.items.length > 0 && (
            <table className="ml-items">
              <tbody>{r.items.map((i, n) => <tr key={n}><td>{i.item || '—'}</td><td className="num">{i.amountCents != null ? peso(i.amountCents) : '—'}</td></tr>)}</tbody>
              {r.discountCents ? <tfoot><tr><td>Less Discount</td><td className="num">− {peso(r.discountCents)}</td></tr></tfoot> : null}
            </table>
          )}
          <dl className="ml-dl">
            <div className="ml-total"><dt>Total</dt><dd>{r.amountCents != null ? peso(r.amountCents) : '—'}</dd></div>
            {r.items.length > 0 && r.amountCents != null && itemsSum - (r.discountCents || 0) !== r.amountCents && <div><dt>Items Add Up To</dt><dd>{peso(itemsSum - (r.discountCents || 0))}</dd></div>}
            {r.paidWith && <div><dt>Paid With</dt><dd>{PAID[r.paidWith] || r.paidWith}</dd></div>}
            {r.onlineCents ? <div><dt>Online</dt><dd>{peso(r.onlineCents)}</dd></div> : null}
            {r.depositCents ? <div><dt>Deposit</dt><dd>{peso(r.depositCents)}</dd></div> : null}
            {r.balanceCents ? <div><dt>Balance</dt><dd>{peso(r.balanceCents)}</dd></div> : null}
          </dl>
          {r.note && <p className="ml-note">{r.note}</p>}
          <p className="field-hint" style={{ margin: 0 }}>To change it, open <Link to={`/finances/receipts?day=${r.day}`}>Receipts</Link>{manager ? <> or the <Link to={`/finances/daily?day=${r.day}`}>Ledger</Link></> : ''} for {prettyDay(r.day)}.</p>
        </div>
      </div>
    </div>
  )
}

export default function ReceiptMasterPage() {
  const staff = useStaff()
  const manager = canManage(staff)
  const [view, setView] = useState(() => ({ when: 'all', kind: '', sort: 'desc', ...saved() }))
  const set = (patch) => setView((v) => { const n = { ...v, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* private window */ } return n })
  const [q, setQ] = useState('')
  const query = useDebounced(q.trim(), 300)
  const [pages, setPages] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)
  const [from, to] = range(view.when) || [null, null]
  const params = new URLSearchParams({ ...(query ? { q: query } : {}), ...(from ? { from, to } : {}), ...(view.kind ? { kind: view.kind } : {}), sort: view.sort })
  const key = params.toString()
  useEffect(() => { setPages(1) }, [key])
  useEffect(() => {
    let live = true
    setBusy(true); setError(null)
    api(`finances/daily/master?${key}&page=${pages}`)
      .then((d) => { if (!live) return; setData((old) => (pages > 1 && old?.key === key ? { ...d, key, receipts: [...old.receipts, ...d.receipts] } : { ...d, key })) })
      .catch((e) => live && setError(e)).finally(() => live && setBusy(false))
    return () => { live = false }
  }, [key, pages])
  const list = data?.key === key ? data.receipts : null
  return (
    <>
      <PageHead crumbs={[{ label: 'Finances' }, { label: 'Master List' }]} title="Master List"
        intro={`Every receipt logged${manager ? ' (Receipts and the Ledger)' : ''}, by receipt number. Tap one to see it. To change a receipt, open its day on ${manager ? 'Receipts or the Ledger' : 'Receipts'}.`} />
      <div className="ml-bar">
        <label className="ml-search">
          <Search aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt no., owner, pet, item" aria-label="Search receipts" />
          {q && <button type="button" className="icon-btn" onClick={() => setQ('')} aria-label="Clear search" title="Clear"><X /></button>}
        </label>
        <div className="ml-chips" role="group" aria-label="Dates">
          {RANGES.map(([k, l]) => <button key={k} type="button" className={`btn btn-sm ${view.when === k ? '' : 'btn-quiet'}`} aria-pressed={view.when === k} onClick={() => set({ when: k })}>{l}</button>)}
        </div>
      </div>
      <div className="ml-bar ml-bar2">
        <div className="ml-chips" role="group" aria-label="Kind of receipt">
          {[['', 'All'], ['QR', 'QR (Quotation Slips)'], ['OR', 'OR (Service Invoices)']].map(([k, l]) => <button key={k} type="button" className={`btn btn-sm ${view.kind === k ? '' : 'btn-quiet'}`} aria-pressed={view.kind === k} onClick={() => set({ kind: k })}>{l}</button>)}
        </div>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => set({ sort: view.sort === 'desc' ? 'asc' : 'desc' })} title="Change the order">
          {view.sort === 'desc' ? <><ArrowDownWideNarrow aria-hidden /> Highest Number First</> : <><ArrowUpNarrowWide aria-hidden /> Lowest Number First</>}
        </button>
        {list && <span className="cell-sub">{data.total} receipt{data.total === 1 ? '' : 's'}{from ? ` · ${prettyDay(from)}${to !== from ? ` to ${prettyDay(to)}` : ''}` : ''}</span>}
      </div>
      <ErrorNote error={error} />
      {!list ? <PawLoader label="Loading receipts…" /> : list.length === 0 ? (
        <div className="card card-pad"><p style={{ margin: 0 }}>No receipts {query ? `match “${query}”` : 'here'}{from ? ' for these dates' : ''}. {query || from || view.kind ? 'Try All Time, or clear the search.' : 'Receipts typed on Receipts or the Ledger show up here.'}</p></div>
      ) : (
        <>
          <div className="ml-grid">
            {list.map((r) => (
              <button key={r.key} type="button" className="card ml-card" onClick={() => setOpen(r)} aria-label={`${r.kind} ${r.number}, ${r.clientName || 'no name'}, ${r.amountCents != null ? peso(r.amountCents) : 'no total'}`}>
                <span className="ml-thumb">
                  {r.photo ? <img src={`/api/finances/daily/photos/${r.photo.id}`} alt="" loading="lazy" style={r.photo.rotate ? { transform: `rotate(${r.photo.rotate}deg) scale(${r.photo.rotate % 180 ? 1.4 : 1})` } : undefined} />
                    : <span className="ml-nothumb"><ReceiptText aria-hidden /></span>}
                  <span className={`badge ${r.kind === 'OR' ? 'badge-warm' : ''} ml-kind`}>{r.kind}</span>
                </span>
                <span className="ml-meta">
                  <strong>{r.number}</strong>
                  <span className="ml-who">{r.clientName || '—'}{r.petNames ? ` · ${r.petNames}` : ''}</span>
                  <span className="ml-line"><span>{prettyDay(r.day)}</span><strong>{r.amountCents != null ? peso(r.amountCents) : '—'}</strong></span>
                </span>
              </button>
            ))}
          </div>
          {list.length < data.total && (
            <div className="inline-row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button type="button" className="btn btn-quiet" onClick={() => setPages((p) => p + 1)} disabled={busy}>{busy ? 'Loading…' : `Show More (${data.total - list.length} more)`}</button>
            </div>
          )}
        </>
      )}
      {open && <ReceiptView r={open} manager={manager} onClose={() => setOpen(null)} />}
    </>
  )
}
