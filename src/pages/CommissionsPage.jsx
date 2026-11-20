// Finances ▸ Commissions (owners and admins): the Ledger's Commissions column added up per day for a start and end
// date, with what was paid out (Expenses of type Vet Commission) and what's still to pay. Tap a day to open it in
// the Ledger. The dates picked are remembered on this device.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote, Field, PageHead, PawLoader } from '../components/ui.jsx'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { peso, shift, today } from './DailyCashPage.jsx'

const KEY = 'commissions-dates'
const monthStart = (d) => `${d.slice(0, 8)}01`
const saved = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v?.from && v?.to ? v : null } catch { return null } }
const keep = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private window */ } }

export default function CommissionsPage() {
  const staff = useStaff()
  const [dates, setDates] = useState(() => saved() || { from: monthStart(today()), to: today() })
  const set = (v) => { setDates(v); keep(v) }
  const ok = dates.from && dates.to && dates.from <= dates.to
  const { data, error } = useApi(canManage(staff) && ok ? `finances/daily/commissions?from=${dates.from}&to=${dates.to}` : null)
  const head = <PageHead crumbs={[{ label: 'Finances' }, { label: 'Commissions' }]} title="Commissions" intro="The Commissions column of the Ledger, added up per day. Paid is what was entered under Expenses as Vet Commission." />
  if (!canManage(staff)) return <>{head}<ErrorNote error={new Error('Only an owner or admin can open Commissions.')} /></>
  const lastMonthEnd = shift(monthStart(today()), -1)
  const quick = [['This Month', monthStart(today()), today()], ['Last Month', monthStart(lastMonthEnd), lastMonthEnd], ['Last 7 Days', shift(today(), -6), today()]]
  const days = data?.days || []
  const total = days.reduce((n, d) => n + d.commissionCents, 0)
  const paid = days.reduce((n, d) => n + d.paidCents, 0)
  const receipts = days.reduce((n, d) => n + d.receipts, 0)
  return (
    <>
      {head}
      <section className="card card-pad stack" style={{ gap: 12 }}>
        <div className="cm-dates">
          <Field label="Start Date">{(a) => <input {...a} type="date" value={dates.from} max={dates.to || undefined} onChange={(e) => set({ ...dates, from: e.target.value })} />}</Field>
          <Field label="End Date">{(a) => <input {...a} type="date" value={dates.to} min={dates.from || undefined} onChange={(e) => set({ ...dates, to: e.target.value })} />}</Field>
          <div className="cm-quick">{quick.map(([label, from, to]) => (
            <button key={label} type="button" className={`btn btn-sm ${dates.from === from && dates.to === to ? '' : 'btn-quiet'}`} onClick={() => set({ from, to })}>{label}</button>
          ))}</div>
        </div>
        {!ok && <ErrorNote error={new Error('Pick a start date on or before the end date.')} />}
      </section>
      <ErrorNote error={error} />
      {ok && !data ? <PawLoader label="Adding up commissions…" /> : ok && (
        <>
          <div className="cm-totals">
            <div className="card card-pad"><span className="label">Commissions</span><strong>{peso(total)}</strong><span className="cell-sub">{receipts} receipt{receipts === 1 ? '' : 's'}</span></div>
            <div className="card card-pad"><span className="label">Paid</span><strong>{peso(paid)}</strong><span className="cell-sub">Expenses: Vet Commission</span></div>
            <div className="card card-pad"><span className="label">{total - paid < 0 ? 'Paid Ahead' : 'Still to Pay'}</span><strong>{peso(Math.abs(total - paid))}</strong><span className="cell-sub">{prettyDay(dates.from)} to {prettyDay(dates.to)}</span></div>
          </div>
          <section className="card">
            {days.length === 0 ? <p className="card-pad" style={{ margin: 0 }}>No commissions in the Ledger for these dates. They come from the Ledger’s Commissions column.</p> : (
              <table className="table">
                <thead><tr><th>Date</th><th className="num">Receipts</th><th className="num">Commissions</th><th className="num">Paid</th></tr></thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.day}>
                      <td><Link to={`/finances/daily?day=${d.day}`} title="Open this day in the Ledger">{prettyDay(d.day)}</Link></td>
                      <td className="num" data-label="Receipts">{d.receipts || '—'}</td>
                      <td className="num" data-label="Commissions">{d.commissionCents ? peso(d.commissionCents) : '—'}</td>
                      <td className="num" data-label="Paid">{d.paidCents ? peso(d.paidCents) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td><strong>Total</strong></td><td className="num" data-label="Receipts"><strong>{receipts}</strong></td><td className="num" data-label="Commissions"><strong>{peso(total)}</strong></td><td className="num" data-label="Paid"><strong>{peso(paid)}</strong></td></tr></tfoot>
              </table>
            )}
          </section>
        </>
      )}
    </>
  )
}
