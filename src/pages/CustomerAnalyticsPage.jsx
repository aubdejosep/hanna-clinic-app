// Client Portal ▸ Customer Analytics (owners): who joins, who comes back, who spends, and who to
// win back. Visits come from the medical records and checked-out appointments, so the old history
// counts; spending starts with payments taken in the app.
import { Link, useSearchParams } from 'react-router-dom'
import { HeartPulse, Repeat, UserCheck, UserPlus, Users, Wallet } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader } from '../components/ui.jsx'
import { BarList, CohortGrid, CompareLine } from '../components/Charts.jsx'
import { useApi } from '../lib/useApi.js'
import { percentChange, prettyDay } from '../lib/format.js'
import { shortDay } from '../lib/appointments.js'

const RANGES = [['mtd', 'Month to Date'], ['7d', 'Last 7 Days'], ['30d', 'Last 30 Days'], ['last_month', 'Last Month'], ['ytd', 'Year to Date']]
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—')

function Tile({ icon: Icon, label, value, note }) {
  return (
    <div className="card stat">
      <div className="stat-top"><span className="label">{label}</span><Icon aria-hidden /></div>
      <div className="stat-value">{value}</div>
      <span className="stat-note">{note}</span>
    </div>
  )
}
function vsBefore(v) {
  const p = percentChange(v.cur, v.prev)
  return p === null ? `${v.prev.toLocaleString()} the period before` : <><span className={p >= 0 ? 'trend-up' : 'trend-down'}>{p >= 0 ? '+' : ''}{p}%</span> vs {v.prev.toLocaleString()} the period before</>
}

export default function CustomerAnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const range = RANGES.some(([k]) => k === params.get('range')) ? params.get('range') : 'mtd'
  const { data: d, error } = useApi(`analytics/customers?range=${range}`)
  const t = d?.tiles
  return (
    <>
      <PageHead crumbs={[{ label: 'Client Portal' }, { label: 'Customer Analytics' }]} title="Customer Analytics" intro="Who joins, who comes back, and who to win back. Spending counts payments taken in the app." />
      <div className="toolbar overview-bar" style={{ padding: 0, marginBottom: 16 }}>
        <div className="tabs" role="group" aria-label="Period">
          {RANGES.map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={range === k} onClick={() => setParams(k === 'mtd' ? {} : { range: k }, { replace: true })}>{l}</button>)}
        </div>
        {d && <span className="cell-sub">{prettyDay(d.range.from)} – {prettyDay(d.range.to)}, compared with {prettyDay(d.range.prevFrom)} – {prettyDay(d.range.prevTo)}</span>}
      </div>
      <ErrorNote error={error} />
      {!d ? <PawLoader label="Working out the numbers…" /> : (
        <div className="stack">
          <div className="stat-grid stat-grid-3">
            <Tile icon={UserPlus} label="New Clients" value={t.newClients.cur.toLocaleString()} note={vsBefore(t.newClients)} />
            <Tile icon={Users} label="Clients Seen" value={t.clientsSeen.cur.toLocaleString()} note={vsBefore(t.clientsSeen)} />
            <Tile icon={Repeat} label="Returning Clients" value={pct(t.returning.n, t.returning.of)} note={`${t.returning.n} of ${t.returning.of} had been here before`} />
            <Tile icon={HeartPulse} label="Repeat Rate" value={pct(t.repeat.n, t.repeat.of)} note={`${t.repeat.n} came on 2 or more days`} />
            <Tile icon={Wallet} label="Spend per Client" value={t.revenuePerClient == null ? '—' : peso(t.revenuePerClient)} note={t.paidClients ? `${t.paidClients} paying clients` : 'Starts with payments in the app'} />
            <Tile icon={UserCheck} label="Active Clients" value={t.active.toLocaleString()} note={`Seen in 6 months · ${t.lapsed.toLocaleString()} lapsed · ${t.never.toLocaleString()} never seen`} />
          </div>

          <section className="card">
            <div className="card-head"><div><h2>Client Retention Cohorts</h2><p>Clients grouped by the month they joined: the share seen again 1, 2, 3… months later. Not tied to the period above.</p></div></div>
            <div className="card-pad"><CohortGrid cohorts={d.cohorts} /></div>
          </section>

          <div className="grid grid-2">
            <section className="card">
              <div className="card-head"><div><h2>Client Acquisition</h2><p>New clients per day, against the period before</p></div></div>
              <div className="card-pad"><CompareLine current={d.acquisition.current} previous={d.acquisition.previous} labelOf={shortDay} /></div>
            </section>
            <section className="card">
              <div className="card-head"><div><h2>Where New Clients Came From</h2><p>How they were first registered</p></div></div>
              <div className="card-pad"><BarList rows={d.sources} empty="No new clients in this period." /></div>
            </section>
          </div>

          <div className="grid grid-2">
            <section className="card">
              <div className="card-head"><div><h2>Top Clients</h2><p>Most visits in this period, then spending</p></div></div>
              {d.top.length ? (
                <table className="table">
                  <thead><tr><th>Client</th><th className="num">Visits</th><th className="num">Spent</th><th className="hide-sm">Last Visit</th></tr></thead>
                  <tbody>
                    {d.top.map((c) => (
                      <tr key={c.id} className="no-hover" style={{ cursor: 'default' }}>
                        <td><Link className="row-link" to={`/clients/${c.id}`}><strong>{c.name}</strong></Link><span className="cell-sub">{c.customerNo}</span></td>
                        <td className="num" data-label="Visits">{c.visits}</td>
                        <td className="num" data-label="Spent">{c.spent ? peso(c.spent) : '—'}</td>
                        <td className="hide-sm nowrap">{prettyDay(c.lastVisit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="card-pad muted" style={{ margin: 0 }}>No visits in this period.</p>}
            </section>
            <section className="card">
              <div className="card-head"><div><h2>Clients to Win Back</h2><p>Came at least twice, last seen 6 to 18 months ago. Worth a message.</p></div></div>
              {d.winBack.length ? (
                <table className="table">
                  <thead><tr><th>Client</th><th>Mobile</th><th className="num">Visits</th><th className="hide-sm">Last Seen</th></tr></thead>
                  <tbody>
                    {d.winBack.map((c) => (
                      <tr key={c.id} className="no-hover" style={{ cursor: 'default' }}>
                        <td><Link className="row-link" to={`/clients/${c.id}`}><strong>{c.name}</strong></Link><span className="cell-sub">{c.pets} pet{c.pets === 1 ? '' : 's'}</span></td>
                        <td data-label="Mobile" className="nowrap">{c.mobile ? <a href={`tel:${c.mobile.replace(/\s/g, '')}`}>{c.mobile}</a> : '—'}</td>
                        <td className="num" data-label="Visits">{c.visits}</td>
                        <td className="hide-sm nowrap">{prettyDay(c.lastVisit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="card-pad muted" style={{ margin: 0 }}>No lapsed regulars right now.</p>}
            </section>
          </div>
        </div>
      )}
    </>
  )
}
