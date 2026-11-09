// Clinic operations → Staff: the old "Manage Staff" list, with the same columns.
import { useState } from 'react'
import { Lock, Pencil, UserPlus, Users } from 'lucide-react'
import { Empty, ErrorNote, PageHead, useToast } from '../components/ui.jsx'
import StaffPanel from '../components/StaffPanel.jsx'
import { useApi } from '../lib/useApi.js'
import { canManage, ROLE_LABEL, useStaff } from '../lib/staff.js'
import { initials, prettyDay } from '../lib/format.js'
import { DAY_CHIPS, DAY_KEYS, hoursSummary } from '../lib/schedule.js'

function StaffAvatar({ s }) {
  const v = s.imagesUpdatedAt ? `?v=${encodeURIComponent(s.imagesUpdatedAt)}` : ''
  return (
    <span className="avatar photo" aria-hidden>
      {s.hasPhoto ? <img src={`/api/staff/${s.id}/photo${v}`} alt="" /> : initials(s.name)}
    </span>
  )
}

export default function StaffPage() {
  const me = useStaff()
  const toast = useToast()
  const [showOff, setShowOff] = useState(false)
  const { data, error, loading, reload } = useApi(`staff${showOff ? '?all=1' : ''}`)
  const [panel, setPanel] = useState(null) // { staff } or { staff: null } for new

  if (!canManage(me)) {
    return (
      <>
        <PageHead title="Manage staff" />
        <div className="card"><Empty icon={Lock} title="For clinic owners" text="Only the clinic owners can see and change staff details." /></div>
      </>
    )
  }

  return (
    <>
      <PageHead crumbs={[{ label: 'Clinic operations' }, { label: 'Staff' }]} title="Manage staff" intro="View, add and manage the people who use the clinic app.">
        <button type="button" className="btn" onClick={() => setPanel({ staff: null })}><UserPlus aria-hidden /> Add staff</button>
      </PageHead>
      <ErrorNote error={error} />

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Show">
            <button type="button" className="tab" aria-pressed={!showOff} onClick={() => setShowOff(false)}>Active</button>
            <button type="button" className="tab" aria-pressed={showOff} onClick={() => setShowOff(true)}>Everyone</button>
          </div>
          <span className="field-hint">{data ? `${data.staff.length} staff member${data.staff.length === 1 ? '' : 's'}` : ' '}</span>
        </div>
        {data && !data.staff.length ? (
          <Empty icon={Users} title="No staff yet" text="Add the first staff member so they can log in." />
        ) : (
          <table className="table">
            <thead><tr><th>Name / email</th><th>Mobile</th><th>Role</th><th>Shift schedule</th><th>Access</th><th><span className="sr-only">Edit</span></th></tr></thead>
            <tbody aria-busy={loading}>
              {(data?.staff || []).map((s) => (
                <tr key={s.id} onClick={() => setPanel({ staff: s })}>
                  <td>
                    <div className="cell-main">
                      <StaffAvatar s={s} />
                      <span>
                        <strong>{s.name}{s.id === me.id ? ' (you)' : ''}</strong>
                        <span className="cell-sub">{s.email}</span>
                      </span>
                    </div>
                  </td>
                  <td data-label="Mobile">{s.phoneLocal || '—'}</td>
                  <td data-label="Role">
                    <span className="badge">{ROLE_LABEL[s.role]}</span>
                    {s.title && <span className="cell-sub">{s.title}</span>}
                  </td>
                  <td data-label="Shift">
                    {hoursSummary(s.schedule) || <span>No shifts set</span>}
                    <span className="day-chips" aria-label="Working days">
                      {DAY_KEYS.map((d) => <span key={d} className={`day-chip ${s.schedule[d] ? 'on' : ''}`}>{DAY_CHIPS[d]}</span>)}
                    </span>
                  </td>
                  <td data-label="Access">
                    {!s.active ? <span className="badge badge-soft">Switched off</span>
                      : s.lockedUntil ? <span className="badge badge-warm">Paused</span>
                        : <span className="badge">Can log in</span>}
                    <span className="cell-sub">{s.lastLoginAt ? `Last login ${prettyDay(s.lastLoginAt.slice(0, 10))}` : 'Never logged in'}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="icon-btn" onClick={(e) => { e.stopPropagation(); setPanel({ staff: s }) }} aria-label={`Edit ${s.name}`} title="Edit"><Pencil /></button>
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
          onClose={() => setPanel(null)}
          onDone={(s, added) => { setPanel(null); reload(); toast(added ? `${s.name} added. They can log in now.` : `${s.name} updated`) }}
        />
      )}
    </>
  )
}
