import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarCheck, CalendarClock, RefreshCw, Search } from 'lucide-react'
import { Empty, ErrorNote, PageHead, Pager, PawLoader, PetAvatar } from '../components/ui.jsx'
import { useAppointmentsChanged } from '../components/TagCheckIn.jsx'
import { query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { addDays, prettyTime } from '../lib/appointments.js'
import { prettyDay } from '../lib/format.js'

const RANGES = [
  ['today', 'Today'],
  ['week', 'Last 7 Days'],
  ['all', 'All'],
]

function useParamsState() {
  const [params, setParams] = useSearchParams()
  const update = useCallback((patch) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, String(v)) : next.delete(k)))
    return next
  }, { replace: true }), [setParams])
  return [params, update]
}

function FollowUpCell({ a }) {
  if (a.followUpDays) {
    const due = addDays(a.day, a.followUpDays)
    return (
      <>
        <span className="badge badge-warm"><CalendarClock aria-hidden /> Due {prettyDay(due)}</span>
        <span className="cell-sub">{a.followUpReason || 'Not booked yet'}</span>
      </>
    )
  }
  return <span className="badge badge-soft">Not Set</span>
}

function Row({ a, navigate }) {
  return (
    <tr onClick={() => navigate(`/appointments/${a.id}`)}>
      <td>
        <div className="cell-main">
          <PetAvatar species={a.pet.species} />
          <span>
            <Link className="row-link" to={`/appointments/${a.id}`} onClick={(e) => e.stopPropagation()}><strong>{a.pet.name}</strong></Link>
            <span className="cell-sub">Owner: {a.owner.name}{a.owner.mobileLocal ? ` · ${a.owner.mobileLocal}` : ''}</span>
          </span>
        </div>
      </td>
      <td data-label="Visit Date">
        {prettyDay(a.day)}
        <span className="cell-sub">{prettyTime(a.time)}</span>
      </td>
      <td data-label="Services">
        {a.items.length ? (
          <>{a.items[0]}{a.items.length > 1 && <span className="cell-sub">+{a.items.length - 1} more</span>}</>
        ) : (
          <span className="muted">No services</span>
        )}
      </td>
      <td data-label="Staff" className="hide-sm">
        {a.staff.length ? a.staff.join(', ') : <span className="muted">—</span>}
      </td>
      <td data-label="Follow-Up">
        <FollowUpCell a={a} />
      </td>
      <td data-label="Action" style={{ width: 1, whiteSpace: 'nowrap' }}>
        <Link className="btn btn-sm btn-quiet" to={`/appointments/${a.id}`} onClick={(e) => e.stopPropagation()}>Open Visit</Link>
      </td>
    </tr>
  )
}

export default function MissingFollowUpPage() {
  const navigate = useNavigate()
  const [params, update] = useParamsState()
  const when = RANGES.some(([k]) => k === params.get('when')) ? params.get('when') : 'all'
  const staffId = params.get('staff') || ''
  const page = Number(params.get('page')) || 1
  const size = Number(params.get('size')) || 25
  const [text, setText] = useState(params.get('q') || '')
  const q = useDebounced(text.trim())
  useEffect(() => { if (q !== (params.get('q') || '')) update({ q, page: '' }) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const staff = useApi('staff/directory').data?.staff || []
  const { data, error, loading, reload } = useApi(
    `appointments/missing-follow-up${query({ when, q: params.get('q') || '', staffId, page, size })}`,
  )
  useAppointmentsChanged(reload)

  const rangeLabel = RANGES.find(([k]) => k === when)?.[1] || 'All'

  return (
    <div className="stack">
      <PageHead
        crumbs={[{ label: 'Appointments', to: '/appointments' }, { label: 'Missing Follow-Up' }]}
        title="Missing Follow-Up"
        subtitle="Completed visits without a follow-up checkup booked. Strictly grooming-only visits are excluded."
      />

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Appointments Requiring Follow-Up</h2>
            <p>
              {data
                ? `${data.total.toLocaleString()} appointment${data.total === 1 ? '' : 's'} · ${rangeLabel}`
                : '…'}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => { if (!loading) reload() }}
            aria-busy={loading}
            aria-label="Refresh"
            title="Refresh"
          >
            {loading ? <PawLoader small label="Refreshing…" /> : <RefreshCw />}
          </button>
        </div>

        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Date Range">
            {RANGES.map(([key, label]) => {
              const count = data?.counts?.[key]
              return (
                <button
                  key={key}
                  type="button"
                  className="tab"
                  aria-pressed={when === key}
                  onClick={() => update({ when: key === 'all' ? '' : key, page: '' })}
                >
                  {label}
                  <span className="tab-count">{count != null ? (count > 999 ? '999+' : count) : '…'}</span>
                </button>
              )
            })}
          </div>
          <div className="search">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="mfu-search">Search</label>
            <input
              id="mfu-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search pets, owners or services"
              autoComplete="off"
            />
          </div>
          <label className="sr-only" htmlFor="mfu-staff">Filter by Staff</label>
          <select
            id="mfu-staff"
            className="select"
            value={staffId}
            onChange={(e) => update({ staff: e.target.value, page: '' })}
          >
            <option value="">Filter by Staff</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {error ? (
          <div className="card-pad"><ErrorNote error={error} /></div>
        ) : data && !data.total ? (
          <Empty
            icon={CalendarCheck}
            title={params.get('q') ? `No appointments match "${params.get('q')}"` : 'All caught up'}
            text={params.get('q')
              ? 'Try another search or date range.'
              : when === 'all'
                ? 'Every completed non-grooming visit has a follow-up booked.'
                : `No appointments are missing a follow-up for ${rangeLabel.toLowerCase()}.`}
          />
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Pet &amp; Owner</th>
                  <th>Visit Date</th>
                  <th>Services</th>
                  <th className="hide-sm">Staff</th>
                  <th>Follow-Up</th>
                  <th><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody aria-busy={loading}>
                {!data && <tr className="no-hover"><td colSpan={6}><PawLoader label="Loading appointments…" /></td></tr>}
                {(data?.appointments || []).map((a) => <Row key={a.id} a={a} navigate={navigate} />)}
              </tbody>
            </table>
            {data && (
              <Pager
                page={page}
                pageSize={size}
                total={data.total}
                onPage={(n) => update({ page: n > 1 ? n : '' })}
                noun="appointments"
                right={(
                  <label className="inline-row" style={{ gap: 8 }}>
                    Rows per page
                    <select
                      className="select"
                      value={size}
                      onChange={(e) => update({ size: e.target.value === '25' ? '' : e.target.value, page: '' })}
                    >
                      {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
              />
            )}
          </>
        )}
      </section>
    </div>
  )
}
