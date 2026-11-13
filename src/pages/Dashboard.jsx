import { useSearchParams, Link } from 'react-router-dom'
import { CalendarCheck, PawPrint, Stethoscope, Syringe, TriangleAlert, UserPlus, Users } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader } from '../components/ui.jsx'
import ClinicBoard from '../components/ClinicBoard.jsx'
import { BarList, Columns, CompareLine, Split } from '../components/Charts.jsx'
import { ReaderSwitch } from '../components/TagCheckIn.jsx'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { percentChange, prettyDay } from '../lib/format.js'
import { shortDay } from '../lib/appointments.js'
import { METHOD_LABEL } from '../components/QuickAdd.jsx'

const RANGES = [['mtd', 'Month to Date'], ['7d', 'Last 7 Days'], ['30d', 'Last 30 Days'], ['last_month', 'Last Month'], ['ytd', 'Year to Date']]
const DAY_NAMES = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }

function Stat({ icon: Icon, label, value }) {
  const pct = percentChange(value.cur, value.prev)
  return (
    <div className="card stat">
      <div className="stat-top"><span className="label">{label}</span><Icon aria-hidden /></div>
      <div className="stat-value">{value.cur.toLocaleString()}</div>
      <span className="stat-note">
        {pct === null ? `${value.prev.toLocaleString()} the period before` : <><span className={pct >= 0 ? 'trend-up' : 'trend-down'}>{pct >= 0 ? '+' : ''}{pct}%</span> vs {value.prev.toLocaleString()} the period before</>}
      </span>
    </div>
  )
}

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Owners and admins only (the server sends `money` to no one else).
function Money({ m }) {
  const pct = percentChange(m.taken.cur, m.taken.prev)
  return (
    <section className="card">
      <div className="card-head"><div><h2>Payments Taken</h2><p>Visits, quick sales and balances paid in the app, plus paid invoices imported from the old system. Voided payments left out. Owners and admins only.</p></div></div>
      <div className="card-pad money-row">
        <div>
          <span className="label">Total</span>
          <div className="stat-value">{peso(m.taken.cur)}</div>
          <span className="stat-note">
            {m.payments.toLocaleString()} payment{m.payments === 1 ? '' : 's'} ·{' '}
            {pct === null ? `${peso(m.taken.prev)} the period before` : <><span className={pct >= 0 ? 'trend-up' : 'trend-down'}>{pct >= 0 ? '+' : ''}{pct}%</span> vs {peso(m.taken.prev)} the period before</>}
          </span>
        </div>
        <div className="money-methods">
          {m.methods.length ? m.methods.map((x) => (
            <div key={x.method}><span className="label">{METHOD_LABEL[x.method] || x.method}</span><strong>{peso(x.amount)}</strong><span className="cell-sub">{x.n} payment{x.n === 1 ? '' : 's'}</span></div>
          )) : <p className="muted" style={{ margin: 0 }}>No payments in this period.</p>}
        </div>
      </div>
      {m.perDay && (
        <div className="card-pad" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="label">Revenue per Day</span>
          <CompareLine current={m.perDay.current} previous={m.perDay.previous} labelOf={shortDay} money />
        </div>
      )}
    </section>
  )
}

function Overview({ range, setRange }) {
  const { data: d, error } = useApi(`dashboard?range=${range}`)
  const review = useApi('stats').data
  const o = d?.outcomes
  const past = o ? o.completed + o.noShow : 0
  return (
    <div className="stack">
      <div className="toolbar overview-bar">
        <div className="tabs" role="group" aria-label="Period">
          {RANGES.map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}
        </div>
        {d && <span className="cell-sub">{prettyDay(d.range.from)} – {prettyDay(d.range.to)}, compared with {prettyDay(d.range.prevFrom)} – {prettyDay(d.range.prevTo)}</span>}
      </div>
      <ErrorNote error={error} />
      <div className="stat-grid">
        {d ? (
          <>
            <Stat icon={CalendarCheck} label="Visits" value={d.totals.visits} />
            <Stat icon={Stethoscope} label="Services Rendered" value={d.totals.services} />
            <Stat icon={Syringe} label="Vaccinations" value={d.totals.vaccinations} />
            <Stat icon={Users} label="New Pet Owners" value={d.totals.owners} />
            <Stat icon={PawPrint} label="New Pets" value={d.totals.pets} />
          </>
        ) : Array.from({ length: 5 }, (_, i) => <div key={i} className="card stat"><span className="skeleton" style={{ width: '60%' }} /></div>)}
      </div>
      {d?.money && <Money m={d.money} />}
      <div className="overview-row">
        <section className="card overview-main">
          <div className="card-head"><div><h2>Visits per Day</h2><p>A visit is a pet seen that day: a checked-out appointment or a medical record.</p></div></div>
          <div className="card-pad">{d ? <CompareLine current={d.perDay.current} previous={d.perDay.previous} labelOf={shortDay} /> : <PawLoader label="Counting visits…" />}</div>
        </section>
        <div className="overview-quad">
        <section className="card">
          <div className="card-head"><div><h2>Services by Category</h2><p>Services on checked-out visits</p></div></div>
          <div className="card-pad">{d && <BarList rows={d.categories} empty="No services on checked-out visits in this period." />}</div>
        </section>
        <section className="card">
          <div className="card-head"><div><h2>Appointment Outcomes</h2><p>Bookings whose day has passed</p></div></div>
          <div className="card-pad">
            {o && (
              <>
                <div className="outcomes">
                  <div><span className="label">Completed</span><strong>{o.completed.toLocaleString()}</strong></div>
                  <div><span className="label">No Show</span><strong>{o.noShow.toLocaleString()}</strong></div>
                  <div><span className="label">Cancelled</span><strong>{o.cancelled.toLocaleString()}</strong></div>
                  <div><span className="label">Rescheduled</span><strong>{o.rescheduled.toLocaleString()}</strong></div>
                </div>
                <p className="field-hint" style={{ margin: '12px 0 0' }}>
                  {past ? `No-show rate: ${Math.round((o.noShow / past) * 100)}% of bookings that weren't cancelled.` : 'No past bookings in this period.'}
                  {' '}Old-system months count its automatic vaccine reminders as bookings, so their no-shows run high.
                </p>
              </>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div><h2>Returning vs New Clients</h2><p>Owners seen in this period: first visit ever, or back again</p></div></div>
          <div className="card-pad">{d && <Split a={{ label: 'Returning', n: d.clients.returning }} b={{ label: 'New', n: d.clients.new }} />}</div>
        </section>
        <section className="card">
          <div className="card-head"><div><h2>Busiest Days</h2><p>Visits by day of the week</p></div></div>
          <div className="card-pad">{d && <Columns rows={d.weekdays.map((w) => ({ label: DAY_NAMES[w.d], n: w.n }))} empty="No visits in this period." />}</div>
        </section>
        </div>
      </div>
      <div className="grid grid-2">
        <section className="card span-2">
          <div className="card-head"><div><h2>Busiest Hours</h2><p>Arrival times from tag taps and Check In</p></div></div>
          <div className="card-pad">
            {d && <Columns rows={Array.from({ length: 13 }, (_, i) => i + 8).map((h) => ({ label: `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`, n: d.hours.find((x) => x.h === h)?.n || 0 }))}
              empty="Fills in as visits are checked in at the front desk. The old system had no arrival times." />}
          </div>
        </section>
        {review && review.ownersToReview > 0 && (
          <section className="card span-2">
            <div className="card-head"><div><h2>Records to Check</h2><p>Found while importing from the old system</p></div></div>
            <div className="card-pad">
              <p style={{ marginTop: 0 }}><strong>{review.ownersToReview} owners</strong> have a missing or shared mobile number, or a duplicate name.</p>
              <Link className="btn btn-quiet" to="/clients?review=1"><TriangleAlert aria-hidden /> Review Owners</Link>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const staff = useStaff()
  const owner = canManage(staff)
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'overview' ? 'overview' : 'board' // the board first; the overview for everyone
  const range = RANGES.some(([k]) => k === params.get('range')) ? params.get('range') : 'mtd'
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n }, { replace: true })
  return (
    <>
      <PageHead title="Clinic Dashboard" intro={view === 'overview' ? `How the clinic is doing${owner ? '' : ', in counts'}.` : 'Today in the clinic, station by station.'}>
        <div className="head-actions">
          {view === 'board' && <ReaderSwitch />}
          <Link className="btn btn-quiet" to="/clients?new=1"><UserPlus aria-hidden /> Register Owner</Link>
        </div>
      </PageHead>
      <div className="tabs" role="group" aria-label="View" style={{ marginBottom: 16 }}>
        <button type="button" className="tab" aria-pressed={view === 'board'} onClick={() => set({ view: '', range: '' })}>Clinic Board</button>
        <button type="button" className="tab" aria-pressed={view === 'overview'} onClick={() => set({ view: 'overview' })}>Overview</button>
      </div>
      {view === 'board' ? <ClinicBoard /> : <Overview range={range} setRange={(r) => set({ range: r === 'mtd' ? '' : r })} />}
    </>
  )
}
