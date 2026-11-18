// Finances ▸ Ledger ▸ Compare with Staff (owners and admins): for one day, staff's Receipts next to the owners'
// Ledger. Receipts are matched by OR/QR number; each shows ✓ Same, Different (the cells that differ), Only in
// Staff's or Only in Yours. Below, the day's figures: staff's typed summary, staff's receipts added up, and yours.
import { Camera } from 'lucide-react'
import { ErrorNote, PawLoader } from './ui.jsx'
import { useApi } from '../lib/useApi.js'
import { summarize } from '../../lib/daily-cash.js'

const peso = (c) => (c == null ? '—' : `${c < 0 ? '−' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`)
const PAID = { cash: 'Cash', gcash: 'GCash', bank: 'Bank', maribank: 'MariBank', card: 'Card', qrph: 'QRPH', none: 'Not counted' }
const keyOf = (r) => (r.receiptNo ? `OR ${r.receiptNo}` : r.receiptQr ? `QR ${r.receiptQr}` : null)
const FIELDS = [['amountCents', 'Total'], ['discountCents', 'Discounts'], ['onlineCents', 'Online'], ['incomeCents', 'Total Income']]
const counted = (r) => r.incomeCents != null

export function compareRows(staff, mine) {
  const out = []
  const used = new Set()
  for (const s of staff) {
    const k = keyOf(s)
    const o = k ? mine.find((m) => !used.has(m.id) && keyOf(m) === k) : null
    if (o) used.add(o.id)
    const diff = o ? FIELDS.filter(([f]) => (s[f] || 0) !== (o[f] || 0)).map(([f]) => f) : []
    if (o && counted(s) !== counted(o)) diff.push('counted')
    out.push({ key: k || `staff-${s.id}`, label: k || 'No receipt no.', s, o, diff, status: !o ? 'staff' : diff.length ? 'diff' : 'same' })
  }
  for (const o of mine) if (!used.has(o.id)) out.push({ key: keyOf(o) || `mine-${o.id}`, label: keyOf(o) || 'No receipt no.', s: null, o, diff: [], status: 'mine' })
  return out
}
const STATUS = { same: ['✓ Same', 'badge'], diff: ['Different', 'badge badge-warn'], staff: ['Only in Staff’s', 'badge badge-soft'], mine: ['Only in Yours', 'badge badge-soft'] }

export default function LedgerCompare({ day, mine }) {
  const { data, error } = useApi(`finances/daily?from=${day}&to=${day}&book=staff`)
  if (error) return <ErrorNote error={error} />
  if (!data || data.from !== day) return <section className="card card-pad"><PawLoader label="Loading staff’s receipts…" /></section>
  const staffLines = data.lines.filter((l) => keyOf(l) || l.clientName || l.amountCents || l.items?.length)
  const myLines = mine.lines.filter((l) => keyOf(l) || l.clientName || l.amountCents)
  const rows = compareRows(staffLines, myLines)
  const s = summarize({ lines: staffLines, expenses: data.expenses, remits: [] })
  const m = summarize(mine)
  const typed = data.summary
  const count = (st) => rows.filter((r) => r.status === st).length
  const cell = (r, side, f) => {
    const x = r[side]
    if (!x) return <td className="lg-num muted">—</td>
    const v = f === 'paid' ? (PAID[x.paidWith] || (x.onlineCents ? 'Online' : '')) : peso(x[f])
    return <td className={`${f === 'paid' ? '' : 'lg-num'} ${r.diff.includes(f) ? 'cmp-off' : ''}`}>{v}</td>
  }
  const figs = [
    ['Total Income (after discounts)', typed?.incomeCents, s.net, m.net],
    ['Discounts', null, s.discounts, m.discounts],
    ['Online', typed?.onlineCents, s.online, m.online],
    ['Expenses', typed?.expensesCents, s.expenses, m.expenses],
    ['1st Remit', typed?.firstRemitCents, null, m.firstRemit],
    ['Cash On Hand', typed?.cashOnHandCents, s.net - s.online - s.expenses - (typed?.firstRemitCents || 0), m.cashOnHand],
  ]
  return (
    <section className="card cmp-card" aria-labelledby="cmp-title">
      <div className="card-head"><div><h2 id="cmp-title">Compare with Staff</h2>
        <p>Staff’s Receipts page next to your Ledger, matched by receipt number. Highlighted cells differ.</p></div>
        <p className="li-counts" style={{ margin: 0 }}>
          <span className="badge">{count('same')} same</span>
          {count('diff') > 0 && <span className="badge badge-warn">{count('diff')} different</span>}
          {count('staff') > 0 && <span className="badge badge-soft">{count('staff')} only in staff’s</span>}
          {count('mine') > 0 && <span className="badge badge-soft">{count('mine')} only in yours</span>}
        </p>
      </div>
      <div className="lg-scroll">
        <table className="li-table cmp-table">
          <thead>
            <tr><th rowSpan={2}>Receipt</th><th colSpan={5} className="cmp-side">Staff’s Receipts</th><th colSpan={4} className="cmp-side">Your Ledger</th><th rowSpan={2} /></tr>
            <tr><th>Owner</th><th className="lg-num">Total</th><th className="lg-num">Disc.</th><th>Paid With</th><th className="lg-num">Online</th><th>Owner</th><th className="lg-num">Total</th><th className="lg-num">Disc.</th><th className="lg-num">Online</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key + (r.s?.id || '') + (r.o?.id || '')}>
                <td className="nowrap"><strong>{r.label}</strong>{r.s?.photo && <a className="cmp-photo" href={`/api/finances/daily/photos/${r.s.id}`} target="_blank" rel="noreferrer" title="Open staff’s photo" aria-label="Open staff’s photo"><Camera aria-hidden /></a>}</td>
                <td>{r.s ? r.s.clientName : '—'}</td>{cell(r, 's', 'amountCents')}{cell(r, 's', 'discountCents')}{cell(r, 's', 'paid')}{cell(r, 's', 'onlineCents')}
                <td>{r.o ? r.o.clientName : '—'}</td>{cell(r, 'o', 'amountCents')}{cell(r, 'o', 'discountCents')}{cell(r, 'o', 'onlineCents')}
                <td className="li-why"><span className={STATUS[r.status][1]}>{STATUS[r.status][0]}</span>{r.diff.includes('incomeCents') && <span className="li-warn">Total Income differs</span>}{r.diff.includes('counted') && <span className="li-warn">Counted in one, not the other</span>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="muted">Neither has receipts for this day yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="lg-scroll card-pad" style={{ borderTop: '1px solid var(--border)' }}>
        <table className="li-table cmp-figs">
          <thead><tr><th>For the Day</th><th className="lg-num">Staff’s Summary (Typed)</th><th className="lg-num">Staff’s Receipts</th><th className="lg-num">Your Ledger</th><th className="lg-num">Yours − Staff’s Receipts</th></tr></thead>
          <tbody>
            {figs.map(([label, t, sr, mm]) => {
              const d = sr == null ? null : mm - sr
              return (
                <tr key={label}>
                  <td>{label}</td>
                  <td className={`lg-num ${t != null && sr != null && t !== sr ? 'cmp-off' : ''}`}>{peso(t)}</td>
                  <td className="lg-num">{peso(sr)}</td>
                  <td className="lg-num">{peso(mm)}</td>
                  <td className={`lg-num ${d ? 'cmp-off' : ''}`}>{d == null ? '—' : d === 0 ? '✓' : `${d > 0 ? '+' : ''}${peso(d)}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!typed && <p className="field-hint" style={{ margin: '8px 0 0' }}>Staff haven’t saved their summary for this day yet.</p>}
      </div>
    </section>
  )
}
