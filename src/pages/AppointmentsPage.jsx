import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownUp, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Info, LayoutGrid, List, LogIn, RefreshCw, Rows3, Search, TriangleAlert } from 'lucide-react'
import { Empty, ErrorNote, PageHead, PetAvatar, useToast, PawLoader } from '../components/ui.jsx'
import { BookPanel, StatusBadge, WalkInPanel } from '../components/AppointmentPanels.jsx'
import { ReaderSwitch, appointmentsChanged, useAppointmentsChanged } from '../components/TagCheckIn.jsx'
import { api, query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { STATUS, TABS, addDays, clockTime, longDay, manilaToday, prettyTime, shortDay, since, weekday } from '../lib/appointments.js'
import { prettyDay } from '../lib/format.js'

function useParamsState() {
  const [params, setParams] = useSearchParams()
  const update = useCallback((patch) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, String(v)) : next.delete(k)))
    return next
  }, { replace: true }), [setParams])
  return [params, update]
}

// ---------- In Clinic Now ----------
function InClinic() {
  const { data, error, reload } = useApi('appointments/today')
  const [busy, setBusy] = useState(null)
  const toast = useToast()
  useAppointmentsChanged(reload)
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload() }, 60000) // "how long" and taps on another PC; not while hidden
    return () => clearInterval(t)
  }, [reload])
  async function checkOut(a) {
    setBusy(a.id)
    try {
      await api(`appointments/${a.id}/status`, { method: 'POST', body: { to: 'completed' } })
      toast(`${a.pet.name} checked out`)
      appointmentsChanged()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(null)
    }
  }
  if (error) return <ErrorNote error={error} />
  const c = data?.counts || {}
  const booked = (c.accepted || 0) + (c.pending || 0)
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>In Clinic Now</h2>
          <p>{data ? `Today: ${booked} still to come · ${(c.completed || 0)} done · ${(c.no_show || 0) + (c.cancelled || 0)} cancelled or no show` : '…'}</p>
        </div>
      </div>
      {data?.notCheckedOut.length > 0 && (
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <div className="alert" role="note">
            <TriangleAlert aria-hidden />
            <div style={{ flex: 1 }}>
              <strong>Not Checked Out</strong> — {data.notCheckedOut.length} visit{data.notCheckedOut.length > 1 ? 's' : ''} from earlier days {data.notCheckedOut.length > 1 ? 'were' : 'was'} never tapped out. Close {data.notCheckedOut.length > 1 ? 'them' : 'it'} so the records are right.
              <ul className="mini-list">
                {data.notCheckedOut.map((a) => (
                  <li key={a.id}>
                    <Link to={`/appointments/${a.id}`}><strong>{a.pet.name}</strong></Link> · {a.owner.name} · {prettyDay(a.day)} · {STATUS[a.status].label}
                    <button type="button" className="text-btn" onClick={() => checkOut(a)} disabled={busy === a.id}>{busy === a.id ? 'Checking Out…' : 'Check Out'}</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      {!data ? <PawLoader label="Checking who’s in…" /> : !data.inClinic.length ? (
        <p className="card-pad muted" style={{ margin: 0 }}>No pets checked in right now. Tap a pet’s tag at the front desk, or use <strong>Walk In</strong>.</p>
      ) : (
        <ul className="in-clinic">
          {(data?.inClinic || []).map((a) => (
            <li key={a.id}>
              <Link to={`/appointments/${a.id}`} className="in-clinic-row">
                <PetAvatar species={a.pet.species} />
                <span className="in-clinic-who">
                  <strong>{a.pet.name}</strong>
                  <span className="cell-sub">{a.owner.name}{a.items.length ? ` · ${a.items[0]}${a.items.length > 1 ? ` +${a.items.length - 1}` : ''}` : ''}</span>
                </span>
                <StatusBadge status={a.status} emergency={a.emergency} />
                <span className="cell-sub in-clinic-time">
                  {a.status === 'inpatient' ? `Admitted ${prettyDay((a.admittedAt || a.checkedInAt || a.startsAt).slice(0, 10))} · ${since(a.admittedAt || a.checkedInAt)}` : `In ${clockTime(a.checkedInAt)} · ${since(a.checkedInAt)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- Table ----------
const WHEN = [['', 'All Dates'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 Days'], ['upcoming', 'Upcoming'], ['past', 'Past']]
function whenRange(when) {
  const t = manilaToday()
  return {
    today: { from: t, to: t }, tomorrow: { from: addDays(t, 1), to: addDays(t, 1) }, week: { from: t, to: addDays(t, 6) },
    upcoming: { from: t }, past: { to: addDays(t, -1) },
  }[when] || {}
}

function Row({ a, navigate }) {
  const extra = a.legacyInfo || (a.rescheduledFrom ? 'Rescheduled appointment' : a.rescheduledTo ? 'Has a new schedule' : a.reason)
  return (
    <tr onClick={() => navigate(`/appointments/${a.id}`)}>
      <td>
        <div className="cell-main">
          <PetAvatar species={a.pet.species} />
          <span>
            <Link className="row-link" to={`/appointments/${a.id}`} onClick={(e) => e.stopPropagation()}><strong>{a.pet.name}</strong></Link>
            <span className="cell-sub">Owner: {a.owner.name}</span>
          </span>
        </div>
      </td>
      <td data-label="Booked By" className="hide-sm">{a.bookedBy || '—'}{a.kind === 'walk_in' && <span className="cell-sub">Walk-in</span>}</td>
      <td data-label="Date & Time">{prettyDay(a.day)}<span className="cell-sub">{prettyTime(a.time)}</span></td>
      <td data-label="Status"><StatusBadge status={a.status} emergency={a.emergency} />{a.legacyUnclosed && <span className="cell-sub">Left open in the old system</span>}</td>
      <td data-label="Services">
        {a.items.length ? <>{a.items[0]}{a.items.length > 1 && <span className="cell-sub">+{a.items.length - 1} more</span>}</> : <span className="muted">No services</span>}
      </td>
      <td className="hide-sm" style={{ width: 40 }}>{extra && <span className="info-dot" title={extra} aria-label={extra}><Info /></span>}</td>
    </tr>
  )
}

function TableView({ params, update }) {
  const navigate = useNavigate()
  const tab = params.get('tab') || 'all'
  const when = params.get('when') || ''
  const page = Number(params.get('page')) || 1
  const size = Number(params.get('size')) || 25
  const staffId = params.get('staff') || ''
  const order = params.get('order') === 'asc' ? 'asc' : ''
  const [text, setText] = useState(params.get('q') || '')
  const q = useDebounced(text.trim())
  useEffect(() => { if (q !== (params.get('q') || '')) update({ q, page: '' }) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const staff = useApi('staff/directory').data?.staff || []
  const { data, error, loading, reload } = useApi(`appointments${query({ tab, q: params.get('q') || '', page, size, staffId, order, ...whenRange(when) })}`)
  useAppointmentsChanged(reload)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Appointment List</h2><p>{data ? `${data.total.toLocaleString()} appointment${data.total === 1 ? '' : 's'}` : '…'}</p></div>
        <button type="button" className="icon-btn" onClick={() => { if (!loading) reload() }} aria-busy={loading} aria-label="Refresh" title="Refresh">{loading ? <PawLoader small label="Refreshing…" /> : <RefreshCw />}</button>
      </div>
      <div className="toolbar">
        <div className="search">
          <Search aria-hidden />
          <label className="sr-only" htmlFor="appt-search">Search</label>
          <input id="appt-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search pets, owners or services" autoComplete="off" />
        </div>
        <label className="sr-only" htmlFor="appt-when">Dates</label>
        <select id="appt-when" className="select" value={when} onChange={(e) => update({ when: e.target.value, page: '' })}>
          {WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="sr-only" htmlFor="appt-staff">Filter by Staff</label>
        <select id="appt-staff" className="select" value={staffId} onChange={(e) => update({ staff: e.target.value, page: '' })}>
          <option value="">Filter by Staff</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="toolbar tab-scroll">
        <div className="tabs" role="group" aria-label="Status">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" className="tab" aria-pressed={tab === key} onClick={() => update({ tab: key === 'all' ? '' : key, page: '' })}>
              {label}<span className="tab-count">{data ? (data.tabs[key] > 999 ? '999+' : data.tabs[key]) : '…'}</span>
            </button>
          ))}
          {data?.tabs.unclosed > 0 && (
            <button type="button" className="tab" aria-pressed={tab === 'unclosed'} onClick={() => update({ tab: 'unclosed', page: '' })}
              title="Past bookings the old system never closed. The medical records import will mark each as Completed or No Show.">
              Left Open<span className="tab-count">{data.tabs.unclosed > 999 ? '999+' : data.tabs.unclosed}</span>
            </button>
          )}
          {data?.tabs.emergency > 0 && (
            <button type="button" className="tab" aria-pressed={tab === 'emergency'} onClick={() => update({ tab: 'emergency', page: '' })}>
              Emergency<span className="tab-count">{data.tabs.emergency}</span>
            </button>
          )}
        </div>
      </div>
      {error ? <div className="card-pad"><ErrorNote error={error} /></div> : data && !data.total ? (
        <Empty icon={CalendarDays} title={params.get('q') ? `No appointments match "${params.get('q')}"` : 'No appointments here'} text="Try another tab or date, or book one with Book Appointment." />
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Pet &amp; Owner</th><th className="hide-sm">Booked By</th>
                <th><button type="button" className="th-sort" onClick={() => update({ order: order ? '' : 'asc', page: '' })} title={order ? 'Oldest first' : 'Newest first'}>Date &amp; Time <ArrowDownUp aria-hidden /></button></th>
                <th>Status</th><th>Services</th><th className="hide-sm"><span className="sr-only">Notes</span></th>
              </tr>
            </thead>
            <tbody aria-busy={loading}>
              {!data && <tr className="no-hover"><td colSpan={6}><PawLoader label="Loading appointments…" /></td></tr>}
              {(data?.appointments || []).map((a) => <Row key={a.id} a={a} navigate={navigate} />)}
            </tbody>
          </table>
          {data && (
            <div className="pager">
              <label className="inline-row" style={{ gap: 8 }}>Rows per page
                <select className="select" value={size} onChange={(e) => update({ size: e.target.value === '25' ? '' : e.target.value, page: '' })}>
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <span>Page {page} of {pages}</span>
              <div className="pager-btns">
                <button type="button" className="icon-btn" onClick={() => update({ page: page - 1 > 1 ? page - 1 : '' })} disabled={page <= 1} aria-label="Previous Page" title="Previous Page"><ChevronLeft /></button>
                <button type="button" className="icon-btn" onClick={() => update({ page: page + 1 })} disabled={page >= pages} aria-label="Next Page" title="Next Page"><ChevronRight /></button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ---------- Calendar ----------
function Pill({ a }) {
  return (
    <Link to={`/appointments/${a.id}`} className={`cal-pill tone-${STATUS[a.status].tone} ${a.emergency ? 'is-urgent' : ''}`} title={`${a.pet.name} · ${a.owner.name} · ${STATUS[a.status].label}${a.items.length ? ` · ${a.items.join(', ')}` : ''}`}>
      <span className="cal-pill-name">{a.pet.name} <span className="cal-pill-owner">· {a.owner.name}</span></span>
      <span className="cal-pill-time">{prettyTime(a.time)}</span>
    </Link>
  )
}

function CalendarView({ params, update }) {
  const mode = ['day', 'week', 'month'].includes(params.get('cal')) ? params.get('cal') : 'month'
  const date = params.get('date') || manilaToday()
  const today = manilaToday()
  const range = useMemo(() => {
    if (mode === 'day') return { from: date, to: date }
    if (mode === 'week') { const from = addDays(date, -weekday(date)); return { from, to: addDays(from, 6) } }
    const first = `${date.slice(0, 7)}-01`
    const from = addDays(first, -weekday(first))
    return { from, to: addDays(from, 41) }
  }, [mode, date])
  const { data, error, reload } = useApi(`appointments${query({ cal: 1, size: 3000, order: 'asc', ...range })}`)
  useAppointmentsChanged(reload)
  const byDay = useMemo(() => {
    const m = {}
    for (const a of data?.appointments || []) if (a.status !== 'cancelled') (m[a.day] ||= []).push(a)
    return m
  }, [data])
  const step = (n) => {
    if (mode === 'day') return addDays(date, n)
    if (mode === 'week') return addDays(date, 7 * n)
    const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + n)
    return d.toISOString().slice(0, 10)
  }
  const title = mode === 'day' ? longDay(date) : new Date(`${(mode === 'week' ? range.from : date).slice(0, 7)}-15T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const inRange = (data?.appointments || []).filter((a) => a.status !== 'cancelled' && (mode !== 'month' || a.day.slice(0, 7) === date.slice(0, 7))).length
  const days = Array.from({ length: mode === 'month' ? 42 : mode === 'week' ? 7 : 1 }, (_, i) => addDays(range.from, i))
  return (
    <section className="card">
      <div className="cal-head">
        <div className="cal-title">
          <button type="button" className="cal-today" onClick={() => update({ date: '' })} title="Go to today">
            <span>{new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
            <strong>{today.slice(8)}</strong>
          </button>
          <button type="button" className="icon-btn" onClick={() => update({ date: step(-1) })} aria-label="Previous" title="Previous"><ChevronLeft /></button>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={() => update({ date: step(1) })} aria-label="Next" title="Next"><ChevronRight /></button>
          <span className="chip">{data ? `${inRange} appointment${inRange === 1 ? '' : 's'}` : '…'}</span>
        </div>
        <div className="tabs" role="group" aria-label="Calendar view">
          {[['day', 'Day', List], ['week', 'Week', Rows3], ['month', 'Month', LayoutGrid]].map(([k, l, Icon]) => (
            <button key={k} type="button" className="tab" aria-pressed={mode === k} onClick={() => update({ cal: k === 'month' ? '' : k })}><Icon size={14} aria-hidden /> {l}</button>
          ))}
        </div>
      </div>
      <ErrorNote error={error} />
      {!data && !error ? <PawLoader label="Loading the calendar…" /> : mode === 'day' ? (
        <div className="cal-day">
          {(byDay[date] || []).length ? byDay[date].map((a) => <Pill key={a.id} a={a} />) : <p className="muted card-pad" style={{ margin: 0 }}>{data ? 'No appointments this day.' : '…'}</p>}
        </div>
      ) : (
        <div className={`cal-grid cal-${mode}`}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {days.map((d) => {
            const list = byDay[d] || []
            const max = mode === 'month' ? 3 : 40
            const outside = mode === 'month' && d.slice(0, 7) !== date.slice(0, 7)
            return (
              <div key={d} className={`cal-cell ${outside ? 'is-outside' : ''} ${d === today ? 'is-today' : ''}`}>
                <button type="button" className="cal-date" onClick={() => update({ cal: 'day', date: d })} aria-label={`Open ${longDay(d)}`}>
                  {mode === 'week' ? shortDay(d) : Number(d.slice(8))}
                </button>
                {list.slice(0, max).map((a) => <Pill key={a.id} a={a} />)}
                {list.length > max && <button type="button" className="text-btn cal-more" onClick={() => update({ cal: 'day', date: d })}>+{list.length - max} more</button>}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// Opened from the website's staff email (?ref=BK-…): go straight to that booking's appointment,
// or list them when the booking has several pets.
function BookingRef({ refNo, onClear }) {
  const navigate = useNavigate()
  const { data, error } = useApi(`appointments/by-ref?ref=${encodeURIComponent(refNo)}`)
  useEffect(() => {
    if (data?.appointments.length === 1) navigate(`/appointments/${data.appointments[0].id}`, { replace: true })
  }, [data, navigate])
  if (error) return <ErrorNote error={error} />
  if (!data) return <section className="card"><PawLoader label={`Finding booking ${refNo}…`} /></section>
  if (data.appointments.length === 1) return null
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Online Booking {refNo}</h2><p>{data.appointments.length ? `${data.appointments.length} pets in this booking` : 'Not found'}</p></div>
        <button type="button" className="btn btn-quiet" onClick={onClear}>Show All Appointments</button>
      </div>
      {data.appointments.length ? (
        <ul className="appt-mini">
          {data.appointments.map((a) => (
            <li key={a.id}><Link to={`/appointments/${a.id}`}><span><strong>{a.pet}</strong> <span className="cell-sub">{prettyDay(a.day)} · {prettyTime(a.time)}</span></span><StatusBadge status={a.status} /></Link></li>
          ))}
        </ul>
      ) : <p className="card-pad" style={{ margin: 0 }}>This booking isn’t in the app. It may have been cancelled, or its date has passed. Check the website’s booking email for the details.</p>}
    </section>
  )
}

export default function AppointmentsPage() {
  const [params, update] = useParamsState()
  const navigate = useNavigate()
  const toast = useToast()
  const view = params.get('view') === 'calendar' ? 'calendar' : 'table'
  return (
    <>
      <PageHead crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Appointments' }]} title="Appointments" intro="View and manage appointments.">
        <div className="head-actions">
          <ReaderSwitch />
          <button type="button" className="btn btn-quiet" onClick={() => update({ walkin: '1' })}><LogIn aria-hidden /> Walk In</button>
          <button type="button" className="btn" onClick={() => update({ book: '1' })}><CalendarPlus aria-hidden /> Book Appointment</button>
        </div>
      </PageHead>

      <div className="stack">
        {params.get('ref') && <BookingRef refNo={params.get('ref')} onClear={() => update({ ref: '' })} />}
        <InClinic />
        <div className="view-bar">
          <ul className="legend" aria-label="Status colours">
            {['accepted', 'arrived', 'started', 'inpatient', 'dispense', 'completed', 'cancelled', 'no_show'].map((s) => (
              <li key={s}><span className={`legend-dot tone-${STATUS[s].tone}`} aria-hidden /> {STATUS[s].label}</li>
            ))}
          </ul>
          <div className="tabs" role="group" aria-label="View">
            <button type="button" className="tab" aria-pressed={view === 'table'} onClick={() => update({ view: '' })}><ArrowDownUp size={14} aria-hidden /> Table</button>
            <button type="button" className="tab" aria-pressed={view === 'calendar'} onClick={() => update({ view: 'calendar' })}><CalendarDays size={14} aria-hidden /> Calendar</button>
          </div>
        </div>
        {view === 'table' ? <TableView params={params} update={update} /> : <CalendarView params={params} update={update} />}
      </div>

      {params.get('book') === '1' && (
        <BookPanel onClose={() => update({ book: '' })} onDone={(a) => { update({ book: '' }); appointmentsChanged(); toast(`${a.pet.name} booked for ${prettyDay(a.day)}, ${prettyTime(a.time)}`); navigate(`/appointments/${a.id}`) }} />
      )}
      {params.get('walkin') === '1' && (
        <WalkInPanel onClose={() => update({ walkin: '' })} onDone={(a) => { update({ walkin: '' }); appointmentsChanged(); toast(`${a.pet.name} checked in`); navigate(`/appointments/${a.id}`) }} />
      )}
    </>
  )
}

