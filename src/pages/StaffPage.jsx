// Clinic Operations ▸ Staff: the old "Manage Staff" list, with the same columns: Name, Email / Phone, Role
// (job title), Shift Schedule, System Access (switch it on or off right here) and Actions. Search and
// sort by any column. Owners and admins only.
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, Lock, Pencil, Search, UserPlus, UserX, Users } from 'lucide-react'
import { Empty, ErrorNote, PageHead, useToast } from '../components/ui.jsx'
import StaffPanel from '../components/StaffPanel.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, ROLE_LABEL, useStaff } from '../lib/staff.js'
import { initials, prettyDay } from '../lib/format.js'
import { DAY_CHIPS, DAY_KEYS, hoursSummary } from '../lib/schedule.js'

function StaffAvatar({ s }) {
  const v = s.imagesUpdatedAt ? `?v=${encodeURIComponent(s.imagesUpdatedAt)}` : ''
  return (
    <span className="avatar photo staff-avatar" aria-hidden>
      {s.hasPhoto ? <img src={`/api/staff/${s.id}/photo${v}`} alt="" /> : initials(s.name)}
    </span>
  )
}

const SORTS = {
  name: (s) => s.name.toLowerCase(),
  email: (s) => (s.email || '').toLowerCase(),
  role: (s) => (s.title || ROLE_LABEL[s.role] || '').toLowerCase(),
  access: (s) => (s.active ? 0 : 1),
}

function SortHead({ k, label, sort, setSort, className }) {
  const on = sort.key === k
  const Icon = !on ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
  return (
    <th className={className} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => setSort({ key: k, dir: on ? -sort.dir : 1 })}>{label} <Icon aria-hidden /></button>
    </th>
  )
}

export default function StaffPage() {
  const me = useStaff()
  const toast = useToast()
  const [showOff, setShowOff] = useState(false)
  const { data, error, loading, reload } = useApi(`staff${showOff ? '?all=1' : ''}`)
  const [panel, setPanel] = useState(null) // { staff } or { staff: null } for new
  const [q, setQ] = useState('')
  const [sort, setSort] = useState({ key: 'name', dir: 1 })
  const [busy, setBusy] = useState(null)

  const list = useMemo(() => {
    const words = q.trim().toLowerCase()
    const rows = (data?.staff || []).filter((s) => !words || `${s.name} ${s.email} ${s.phoneLocal || ''} ${s.title || ''} ${ROLE_LABEL[s.role]}`.toLowerCase().includes(words))
    const by = SORTS[sort.key]
    return [...rows].sort((a, b) => (by(a) < by(b) ? -sort.dir : by(a) > by(b) ? sort.dir : 0))
  }, [data, q, sort])

  async function setAccess(s, active) {
    if (!active && !window.confirm(`Switch off ${s.name}’s access? They’re logged out at once, and their name stays on past records.`)) return
    setBusy(s.id)
    try {
      await api(`staff/${s.id}`, { method: 'PATCH', body: { active } })
      toast(active ? `${s.name} can log in again` : `${s.name} switched off`)
      reload()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (!canManage(me)) {
    return (
      <>
        <PageHead title="Manage Staff" />
        <div className="card"><Empty icon={Lock} title="For Clinic Owners" text="Only the clinic owners can see and change staff details." /></div>
      </>
    )
  }

  const active = (data?.staff || []).filter((s) => s.active).length
  return (
    <>
      <PageHead crumbs={[{ label: 'Clinic Operations' }, { label: 'Staff' }]} title="Manage Staff" intro="View, register and manage the people who work at the clinic.">
        <button type="button" className="btn" onClick={() => setPanel({ staff: null })}><UserPlus aria-hidden /> Add Staff</button>
      </PageHead>
      <ErrorNote error={error} />

      <section className="card">
        <div className="card-head">
          <div><h2>Staff List <span className="badge badge-soft">{data ? `${active} active` : '…'}</span></h2><p>{data ? `${data.staff.length} staff member${data.staff.length === 1 ? '' : 's'}${showOff ? ', including those switched off' : ''}` : ' '}</p></div>
        </div>
        <div className="toolbar">
          <div className="search"><Search aria-hidden /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff…" aria-label="Search staff" /></div>
          <div className="tabs" role="group" aria-label="Show">
            <button type="button" className="tab" aria-pressed={!showOff} onClick={() => setShowOff(false)}>Active</button>
            <button type="button" className="tab" aria-pressed={showOff} onClick={() => setShowOff(true)}>Everyone</button>
          </div>
        </div>
        {data && !list.length ? (
          <Empty icon={Users} title={q ? `No staff match “${q}”` : 'No Staff Yet'} text={q ? 'Try part of a name, email or role.' : 'Add the first staff member so they can log in.'} />
        ) : (
          <table className="table staff-table">
            <thead>
              <tr>
                <SortHead k="name" label="Name" sort={sort} setSort={setSort} />
                <SortHead k="email" label="Email / Phone" sort={sort} setSort={setSort} />
                <SortHead k="role" label="Role" sort={sort} setSort={setSort} />
                <th className="hide-sm">Shift Schedule</th>
                <SortHead k="access" label="System Access" sort={sort} setSort={setSort} />
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody aria-busy={loading}>
              {list.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'is-off'}>
                  <td>
                    <div className="cell-main">
                      <StaffAvatar s={s} />
                      <span>
                        <strong>{s.name}{s.id === me.id ? ' (you)' : ''}</strong>
                        <span className="cell-sub">{ROLE_LABEL[s.role]}</span>
                      </span>
                    </div>
                  </td>
                  <td data-label="Email / Phone">{s.email || '—'}<span className="cell-sub">{s.phoneLocal || 'No mobile'}</span></td>
                  <td data-label="Role"><span className="badge staff-title">{s.title || ROLE_LABEL[s.role]}</span></td>
                  <td data-label="Shift" className="hide-sm staff-shift">
                    {hoursSummary(s.schedule) || <span className="cell-sub">No shifts set</span>}
                    <span className="day-chips" aria-label="Working days">
                      {DAY_KEYS.map((d) => <span key={d} className={`day-chip ${s.schedule[d] ? 'on' : ''}`}>{DAY_CHIPS[d]}</span>)}
                    </span>
                  </td>
                  <td data-label="System Access">
                    <span className="access-row" title={s.id === me.id ? 'You can’t switch off your own account' : s.active ? 'Switch off their access' : 'Let them log in again'}>
                      <label className={`switch ${s.id === me.id ? 'is-disabled' : ''}`}>
                        <input type="checkbox" role="switch" checked={s.active} disabled={s.id === me.id || busy === s.id} onChange={(e) => setAccess(s, e.target.checked)} aria-label={`${s.name} can log in`} />
                        <span aria-hidden />
                      </label>
                      <strong>{!s.active ? 'Switched Off' : s.lockedUntil ? 'Paused' : 'Anytime'}</strong>
                    </span>
                    {s.active && <span className="cell-sub">All devices</span>}<span className="cell-sub">{s.lastLoginAt ? `Last login ${prettyDay(s.lastLoginAt.slice(0, 10))}` : 'Never logged in'}</span>
                  </td>
                  <td className="num">
                    <span className="row-actions">
                      <button type="button" className="icon-btn" onClick={() => setPanel({ staff: s, at: 'staff-schedule' })} aria-label={`${s.name}: shift schedule`} title="Shift Schedule"><CalendarClock /></button>
                      <button type="button" className="icon-btn" onClick={() => setPanel({ staff: s })} aria-label={`Edit ${s.name}`} title="Edit"><Pencil /></button>
                      {s.active && s.id !== me.id && <button type="button" className="icon-btn icon-danger" onClick={() => setAccess(s, false)} aria-label={`Switch off ${s.name}`} title="Switch Off Access"><UserX /></button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {panel && (
        <StaffPanel
          staff={panel.staff}
          me={me}
          scrollTo={panel.at}
          onClose={() => setPanel(null)}
          onDone={(s, added) => { setPanel(null); reload(); toast(added ? `${s.name} added. They can log in now.` : `${s.name} updated`) }}
        />
      )}
    </>
  )
}
