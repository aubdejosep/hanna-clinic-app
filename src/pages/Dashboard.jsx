import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { CalendarCheck, PawPrint, Stethoscope, Syringe, TriangleAlert, UserPlus, Users } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader } from '../components/ui.jsx'
import ClinicBoard from '../components/ClinicBoard.jsx'
import { BarList, Columns, CompareLine, MultiLine, Split } from '../components/Charts.jsx'
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

// Finances ▸ Ledger on the Overview (owners and admins): its own period (This Week … Last Year, or Custom
// Dates), compared with the period before; income per day, with Expenses and Commissions as lines you can
// switch on. The period and the switches are remembered on this device.
const LEDGER_LINES = [['expenses', 'Expenses', 2], ['commissions', 'Commissions', 3]]
const LEDGER_KEY = 'overview-ledger-lines'
const LEDGER_RANGE_KEY = 'overview-ledger-range'
const LEDGER_RANGES = [['this_week', 'This Week'], ['last_week', 'Last Week'], ['this_month', 'This Month'], ['last_month', 'Last Month'],
  ['last_30', 'Last 30 Days'], ['ytd', 'Year to Date'], ['last_year', 'Last Year'], ['custom', 'Custom Dates']]
const addD = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const monthStart = (d) => `${d.slice(0, 8)}01`
const spanDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5)
const sameDayLastYear = (d) => { const t = `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`; return t.endsWith('-02-29') ? t.replace('-02-29', '-02-28') : t }
function ledgerRange(key, custom = {}, today = manilaToday()) {
  const monday = addD(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
  const before = (from, to) => ({ from, to, prevFrom: addD(from, -(spanDays(from, to) + 1)), prevTo: addD(from, -1) })
  const y = Number(today.slice(0, 4))
  switch (key) {
    case 'this_week': return { from: monday, to: today, prevFrom: addD(monday, -7), prevTo: addD(today, -7) }
    case 'last_week': return before(addD(monday, -7), addD(monday, -1))
    case 'last_month': { const to = addD(monthStart(today), -1); const from = monthStart(to); return { from, to, prevFrom: monthStart(addD(from, -1)), prevTo: addD(from, -1) } }
    case 'last_30': return before(addD(today, -29), today)
    case 'ytd': return { from: `${y}-01-01`, to: today, prevFrom: `${y - 1}-01-01`, prevTo: sameDayLastYear(today) }
    case 'last_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, prevFrom: `${y - 2}-01-01`, prevTo: `${y - 2}-12-31` }
    case 'custom': {
      const from = custom.from || monthStart(today)
      const to = custom.to && custom.to >= from ? custom.to : from
      return before(from, to)
    }
    default: { // this_month: the same days of last month
      const from = monthStart(today)
      const prevFrom = monthStart(addD(from, -1))
      const prevTo = [addD(prevFrom, spanDays(from, today)), addD(from, -1)].sort()[0]
      return { from, to: today, prevFrom, prevTo }
    }
  }
}
const remembered = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback } }
const remember = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } }

function LedgerOverview() {
  const [on, setOn] = useState(() => remembered(LEDGER_KEY, {}))
  const [pick, setPick] = useState(() => remembered(LEDGER_RANGE_KEY, { key: 'this_month' }))
  const choose = (p) => { setPick(p); remember(LEDGER_RANGE_KEY, p) }
  const flip = (k) => setOn((o) => { const n = { ...o, [k]: !o[k] }; remember(LEDGER_KEY, n); return n })
  const r = ledgerRange(pick.key, pick)
  const { data: l, error } = useApi(`finances/daily/overview?from=${r.from}&to=${r.to}&prevFrom=${r.prevFrom}&prevTo=${r.prevTo}`)
  const vs = (cur, prev) => { const p = percentChange(cur, prev); return p === null ? `${peso(prev)} the period before` : <><span className={p >= 0 ? 'trend-up' : 'trend-down'}>{p >= 0 ? '+' : ''}{p}%</span> vs {peso(prev)}</> }
  const points = (k) => (l?.perDay || []).map((d) => ({ day: d.day, n: d[k] }))
  const series = [{ key: 'income', label: 'Income', color: 1, points: points('income') },
    ...LEDGER_LINES.filter(([k]) => on[k]).map(([k, label, color]) => ({ key: k, label, color, points: points(k) }))]
  const fresh = l && l.range.from === r.from && l.range.to === r.to
  return (
    <section className="card">
      <div className="card-head ledger-head">
        <div><h2>Ledger</h2><p>From Finances ▸ Ledger: Total Income, Expenses and Commissions as typed or imported there. Owners and admins only.</p></div>
        <Link className="text-btn" to="/finances/daily">Open Ledger</Link>
      </div>
      <div className="card-pad ledger-range">
        <label className="ledger-range-pick"><span className="sr-only">Period</span>
          <select className="select" value={pick.key} onChange={(e) => choose({ ...pick, key: e.target.value, ...(e.target.value === 'custom' && !pick.from ? { from: r.from, to: r.to } : {}) })}>
            {LEDGER_RANGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        {pick.key === 'custom' && (
          <span className="ledger-custom">
            <label><span className="sr-only">From</span><input type="date" className="select" value={pick.from || r.from} max={pick.to || undefined} onChange={(e) => e.target.value && choose({ ...pick, from: e.target.value })} /></label>
            <span aria-hidden>to</span>
            <label><span className="sr-only">To</span><input type="date" className="select" value={pick.to || r.to} min={pick.from || undefined} onChange={(e) => e.target.value && choose({ ...pick, to: e.target.value })} /></label>
          </span>
        )}
        <span className="cell-sub">{prettyDay(r.from)}{r.to !== r.from ? ` – ${prettyDay(r.to)}` : ''}, compared with {prettyDay(r.prevFrom)}{r.prevTo !== r.prevFrom ? ` – ${prettyDay(r.prevTo)}` : ''}</span>
      </div>
      <ErrorNote error={error} />
      {!l ? <div className="card-pad"><PawLoader label="Adding up the Ledger…" /></div> : (
        <div style={{ opacity: fresh ? 1 : 0.5, transition: 'opacity .15s' }}>
          <div className="card-pad" style={{ paddingTop: 0 }}>
            {!l.days && !l.prev.income && !l.prev.expenses ? <p className="muted" style={{ margin: 0 }}>Nothing in the Ledger for these dates.</p> : (
              <div className="ledger-totals">
                <div><span className="label">Income</span><strong>{peso(l.cur.income)}</strong><span className="stat-note">{vs(l.cur.income, l.prev.income)}</span></div>
                <div><span className="label">Expenses</span><strong>{peso(l.cur.expenses)}</strong><span className="stat-note">{vs(l.cur.expenses, l.prev.expenses)}</span></div>
                <div><span className="label">Commissions</span><strong>{peso(l.cur.commissions)}</strong><span className="stat-note">{vs(l.cur.commissions, l.prev.commissions)}</span></div>
                <div><span className="label">Income Less Expenses</span><strong>{peso(l.cur.income - l.cur.expenses)}</strong><span className="stat-note">{l.days} day{l.days === 1 ? '' : 's'} in the Ledger</span></div>
              </div>
            )}
          </div>
          <div className="card-pad" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="ledger-toggles">
              <span className="label" style={{ marginRight: 'auto' }}>Income per Day</span>
              {LEDGER_LINES.map(([k, label, color]) => (
                <button key={k} type="button" className="chip-btn" aria-pressed={!!on[k]} onClick={() => flip(k)}><i className={`key key-${color}`} /> {label}</button>
              ))}
            </div>
            <MultiLine series={series} labelOf={shortDay} />
          </div>
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
      {d?.money && <LedgerOverview />}
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
