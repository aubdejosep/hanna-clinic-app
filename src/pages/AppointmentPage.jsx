import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, CalendarClock, CalendarDays, CircleX, Clock, History, MessageSquare, Nfc, Plus, Siren, Stethoscope, Trash2, TriangleAlert, Undo2, User, UserRound } from 'lucide-react'
import { ErrorNote, Field, PageHead, Panel, PetAvatar, useToast } from '../components/ui.jsx'
import { BookPanel, CancelPanel, ReschedulePanel, ServicePicker, StaffSelect, StatusBadge } from '../components/AppointmentPanels.jsx'
import { appointmentsChanged, useAppointmentsChanged } from '../components/TagCheckIn.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { age, prettyDay, SEX_LABEL, SPECIES_LABEL } from '../lib/format.js'
import { ACTIONS, STATUS, addDays, clockTime, longDay, prettyTime } from '../lib/appointments.js'
import { canManage, useStaff } from '../lib/staff.js'
import { VisitRecord } from '../components/MedicalRecords.jsx'

const PATH = [
  ['accepted', 'Accepted'], ['arrived', 'Arrived'], ['started', 'Started'],
  ['inpatient', 'Inpatient', true], ['dispense', 'Dispense', true], ['completed', 'Completed'],
]
const VIA = { button: '', tag: ' (tag tap)', auto: ' (end of day)', booking: '', import: ' (old system)' }

function Stepper({ a }) {
  const reached = new Set(a.history.map((h) => h.to).concat(a.status))
  if (a.status === 'pending') reached.add('accepted')
  const order = PATH.map(([k]) => k)
  const at = order.indexOf(a.status === 'pending' ? 'accepted' : a.status)
  return (
    <ol className="kiosk-steps appt-steps" style={{ gridTemplateColumns: `repeat(${PATH.length}, 1fr)` }}>
      {PATH.map(([key, label, optional], i) => {
        const done = at > i && (!optional || reached.has(key))
        const skipped = at > i && optional && !reached.has(key)
        const S = STATUS[key]
        return (
          <li key={key} className={`${done ? 'done' : ''} ${at === i ? 'current' : ''} ${skipped ? 'skipped' : ''} ${optional ? 'optional' : ''}`}>
            <span className="kiosk-dot"><S.icon aria-hidden /></span>
            <span className="kiosk-step-label">{label}{optional && <small>If needed</small>}</span>
          </li>
        )
      })}
    </ol>
  )
}

function StatusControl({ a, onChange }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const actions = ACTIONS[a.status] || []
  async function go(body, key) {
    setBusy(key)
    setError(null)
    try {
      const res = await api(`appointments/${a.id}/status`, { method: 'POST', body })
      onChange(res.appointment, body.undo ? 'Step undone' : `${a.pet.name}: ${STATUS[body.to].label}`)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }
  const closed = ['cancelled', 'no_show'].includes(a.status)
  return (
    <section className="card">
      <div className="card-head"><div><h2>Status Control</h2><p>Appointment progress</p></div><StatusBadge status={a.status} emergency={a.emergency} /></div>
      <div className="card-pad stack">
        {closed ? (
          <div className="alert" role="note">
            <CircleX aria-hidden />
            <span>{a.status === 'cancelled' ? <>Cancelled{a.cancelReason ? `: ${a.cancelReason}` : ''}.</> : <>No Show: nobody tapped in for this booking on the day.</>}</span>
          </div>
        ) : <Stepper a={a} />}
        <ErrorNote error={error} />
        {actions.length > 0 && (
          <div className="status-actions">
            {actions.map(([to, label, hint], i) => (
              <button key={to} type="button" className={`btn ${i === 0 ? '' : 'btn-quiet'}`} onClick={() => go({ to }, to)} disabled={!!busy} title={hint || undefined}>
                {busy === to ? 'Saving…' : label} {i === 0 && <ArrowRight aria-hidden />}
              </button>
            ))}
          </div>
        )}
        {actions.length > 0 && actions[0][2] && <p className="field-hint" style={{ margin: 0 }}>{actions.map(([, l, h]) => h && `${l}: ${h.toLowerCase()}`).filter(Boolean).join(' · ')}.</p>}
        {a.status === 'completed' && <p style={{ margin: 0 }}>Visit closed{a.checkedOutAt ? ` at ${clockTime(a.checkedOutAt)}` : ''}.</p>}
        {a.canUndo && (
          <button type="button" className="text-btn" onClick={() => go({ undo: true }, 'undo')} disabled={!!busy}>
            <Undo2 size={14} aria-hidden /> {busy === 'undo' ? 'Undoing…' : 'Undo Last Step'}
          </button>
        )}
      </div>
    </section>
  )
}

// Weight taken at this visit; also becomes the pet's latest weight.
function WeightToday({ a, onChange }) {
  const [kg, setKg] = useState(a.weightKg ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`appointments/${a.id}`, { method: 'PATCH', body: { weightKg: kg } })
      onChange(res.appointment, kg === '' ? 'Weight cleared' : `Weight saved: ${kg} kg`)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const changed = String(kg) !== String(a.weightKg ?? '')
  return (
    <div>
      <label className="field-label" htmlFor="weight-today">Weight Today (kg)</label>
      <div className="inline-row" style={{ marginTop: 6 }}>
        <input id="weight-today" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" maxLength={6}
          placeholder={a.pet.weightKg ? `Last: ${a.pet.weightKg} kg` : 'e.g. 4.5'} aria-invalid={!!error} />
        <button type="button" className="btn btn-quiet" onClick={save} disabled={busy || !changed}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {error && <span className="field-error">{error.message}</span>}
    </div>
  )
}

// Needs a Follow-Up: the vet ticks it; the bell reminds until a later booking exists.
function FollowUp({ a, onChange, setPanel }) {
  const [editing, setEditing] = useState(false)
  const [days, setDays] = useState(a.followUpDays || 7)
  const [reason, setReason] = useState(a.followUpReason || '')
  const [busy, setBusy] = useState(false)
  async function save(value) {
    setBusy(true)
    try {
      const res = await api(`appointments/${a.id}`, { method: 'PATCH', body: { followUpDays: value, followUpReason: reason } })
      onChange(res.appointment, value ? `Follow-up needed in ${value} days` : 'Follow-up removed')
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }
  const due = a.followUpDays && addDays(a.day, a.followUpDays)
  return (
    <>
      <span className="label" style={{ marginTop: 6 }}>Follow-Up</span>
      {editing ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="inline-row">
            <label className="sr-only" htmlFor="fu-days">In how many days</label>
            <select id="fu-days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[3, 5, 7, 10, 14, 21, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>In {d} days</option>)}
            </select>
          </div>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Reason, e.g. recheck wound, 2nd vaccine dose" aria-label="Reason for the follow-up" />
          <div className="inline-row">
            <button type="button" className="btn" onClick={() => save(days)} disabled={busy}>{busy ? 'Saving…' : 'Save Follow-Up'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : a.followUpDays ? (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>Needed by <strong>{prettyDay(due)}</strong> (in {a.followUpDays} days){a.followUpReason ? `: ${a.followUpReason}` : ''}.</p>
          {a.laterBooking
            ? <Link className="chip" to={`/appointments/${a.laterBooking.id}`}><CalendarDays aria-hidden /> Booked for {prettyDay(a.laterBooking.day)}</Link>
            : <button type="button" className="btn" onClick={() => setPanel('followup')}><CalendarClock aria-hidden /> Book Follow-Up</button>}
          <div className="inline-row">
            <button type="button" className="text-btn" onClick={() => setEditing(true)}>Change</button>
            <button type="button" className="text-btn" onClick={() => save(null)} disabled={busy}>Not Needed</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}><CalendarClock aria-hidden /> Needs a Follow-Up</button>
      )}
    </>
  )
}

function Actions({ a, onChange, setPanel }) {
  const [busy, setBusy] = useState(false)
  const canSchedule = ['pending', 'accepted', 'no_show'].includes(a.status)
  const canCancel = ['pending', 'accepted', 'no_show', 'arrived'].includes(a.status)
  async function emergency() {
    setBusy(true)
    try {
      const res = await api(`appointments/${a.id}`, { method: 'PATCH', body: { emergency: !a.emergency } })
      onChange(res.appointment, a.emergency ? 'Emergency flag removed' : 'Marked as emergency')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <div className="card-head"><div><h2>Appointment Actions</h2><p>Schedule, emergency and follow-up</p></div></div>
      <div className="card-pad stack" style={{ gap: 10 }}>
        <span className="label">Emergency Control</span>
        <button type="button" className={`btn ${a.emergency ? 'btn-dark' : 'btn-quiet'}`} onClick={emergency} disabled={busy || a.status === 'cancelled'}>
          <Siren aria-hidden /> {a.emergency ? 'Remove Emergency Flag' : 'Mark as Emergency'}
        </button>
        <span className="label" style={{ marginTop: 6 }}>Scheduling</span>
        <button type="button" className="btn btn-quiet" onClick={() => setPanel('reschedule')} disabled={!canSchedule}><CalendarClock aria-hidden /> Reschedule</button>
        <button type="button" className="btn btn-quiet" onClick={() => setPanel('cancel')} disabled={!canCancel}><CircleX aria-hidden /> Cancel</button>
        {!canSchedule && !canCancel && <p className="field-hint" style={{ margin: 0 }}>{a.status === 'completed' ? 'This visit is closed.' : a.status === 'cancelled' ? 'This appointment is cancelled.' : 'The visit has started, so it can’t be moved now.'}</p>}
        {!['cancelled', 'no_show', 'pending', 'accepted'].includes(a.status) && <FollowUp a={a} onChange={onChange} setPanel={setPanel} />}
      </div>
    </section>
  )
}

function StaffCard({ a, onChange }) {
  const [editing, setEditing] = useState(false)
  const [ids, setIds] = useState(a.staff.map((s) => s.id))
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const res = await api(`appointments/${a.id}`, { method: 'PATCH', body: { staffIds: ids } })
      onChange(res.appointment, 'Staff saved')
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Staff Assignment</h2><p>Assign veterinarians</p></div>
        {!editing && <button type="button" className="btn btn-quiet" onClick={() => { setIds(a.staff.map((s) => s.id)); setEditing(true) }}>{a.staff.length ? 'Change' : 'Assign Staff'}</button>}
      </div>
      <div className="card-pad stack" style={{ gap: 12 }}>
        {editing ? (
          <>
            <StaffSelect value={ids} onChange={setIds} />
            <div className="panel-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Staff'}</button>
            </div>
          </>
        ) : a.staff.length ? (
          <div className="chips">{a.staff.map((s) => <span key={s.id} className="chip"><Stethoscope aria-hidden /> {s.name}</span>)}</div>
        ) : <p className="muted" style={{ margin: 0 }}>No one assigned yet.</p>}
      </div>
    </section>
  )
}

function Notes({ a, onChange }) {
  const me = useStaff()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function add() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`appointments/${a.id}/notes`, { method: 'POST', body: { body: text } })
      onChange({ ...a, notes: [res.note, ...a.notes] }, 'Note added')
      setText('')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  async function remove(n) {
    await api(`appointments/${a.id}/notes/${n.id}`, { method: 'DELETE' })
    onChange({ ...a, notes: a.notes.filter((x) => x.id !== n.id) }, 'Note removed')
  }
  return (
    <section className="card">
      <div className="card-head"><div><h2>Staff Notes</h2><p>{a.notes.length} note{a.notes.length === 1 ? '' : 's'} · clinic-internal</p></div></div>
      <div className="card-pad stack" style={{ gap: 12 }}>
        <ErrorNote error={error} />
        <Field label="Add a Note" hint="Only clinic staff see notes.">
          {(f) => <textarea {...f} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} style={{ minHeight: 64 }} />}
        </Field>
        <button type="button" className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={add} disabled={busy || !text.trim()}><MessageSquare aria-hidden /> {busy ? 'Adding…' : 'Add Note'}</button>
        {a.notes.length > 0 && (
          <ul className="notes">
            {a.notes.map((n) => (
              <li key={n.id}>
                <p>{n.body}</p>
                <span className="cell-sub">{n.author} · {prettyDay(n.at.slice(0, 10))} {clockTime(n.at)}</span>
                {(n.staffId === me?.id || canManage(me)) && (
                  <button type="button" className="icon-btn" onClick={() => remove(n)} aria-label="Remove note" title="Remove Note"><Trash2 /></button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Items({ a, onChange }) {
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      let last = null
      for (const it of picked) last = await api(`appointments/${a.id}/items`, { method: 'POST', body: it })
      if (last) onChange(last.appointment, `${picked.length} added`)
      setAdding(false)
      setPicked([])
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  async function remove(it) {
    const res = await api(`appointments/${a.id}/items/${it.id}`, { method: 'DELETE' })
    onChange(res.appointment, `${it.name} removed`)
  }
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Services &amp; Products</h2><p>{a.items.length} item{a.items.length === 1 ? '' : 's'} on this appointment</p></div>
        {a.status !== 'cancelled' && <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}><Plus aria-hidden /> Add Items</button>}
      </div>
      {a.items.length ? (
        <table className="table">
          <thead><tr><th>Item</th><th>Type</th><th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {a.items.map((it) => (
              <tr key={it.id} style={{ cursor: 'default' }}>
                <td><strong>{it.name}</strong>{it.detail && <span className="cell-sub">{it.detail}</span>}</td>
                <td data-label="Type">{it.kind === 'product' ? 'Product' : 'Service'}{it.qty !== 1 && ` × ${it.qty}`}</td>
                <td style={{ textAlign: 'right' }}>{a.status !== 'cancelled' && <button type="button" className="icon-btn" onClick={() => remove(it)} aria-label={`Remove ${it.name}`} title="Remove"><Trash2 /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="card-pad muted" style={{ margin: 0 }}>No services yet. Add what was done during the visit.</p>}
      {adding && (
        <Panel dirty={picked.length > 0} discardTitle="Discard the items you picked?" title="Add Services & Products" intro={`${a.pet.name} · ${prettyDay(a.day)}`} onClose={() => setAdding(false)} busy={busy}
          footer={<><button type="button" className="btn btn-quiet" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn" onClick={save} disabled={busy || !picked.length}>{busy ? 'Adding…' : `Add ${picked.length || ''} Item${picked.length === 1 ? '' : 's'}`}</button></>}>
          <ErrorNote error={error} />
          <ServicePicker items={picked} setItems={setPicked} products />
        </Panel>
      )}
    </section>
  )
}

function PetProfile({ a }) {
  const p = a.pet
  return (
    <section className="card">
      <div className="card-head"><div><h2>Pet Profile</h2><p>Appointment patient</p></div></div>
      <div className="card-pad pet-profile">
        <PetAvatar species={p.species} large />
        <Link to={`/pets/${p.id}`}><strong className="pet-profile-name">{p.name}</strong></Link>
        <span className="chip">{SPECIES_LABEL[p.species]}{p.breed ? ` · ${p.breed}` : ''}</span>
        <span className="profile-meta"><span><User aria-hidden /> <Link to={`/clients/${a.owner.id}`}>{a.owner.name}</Link></span>
          {a.owner.mobileLocal && <span><a href={`tel:${a.owner.mobile}`}>{a.owner.mobileLocal}</a></span>}</span>
        <div className="facts" style={{ padding: 0, width: '100%' }}>
          <div className="fact"><span className="label">Age</span><span className="fact-value">{age(p.birthdate) || '—'}</span></div>
          <div className="fact"><span className="label">Sex</span><span className="fact-value">{SEX_LABEL[p.sex]}</span></div>
        </div>
        <div style={{ width: '100%' }}>
          <span className="label">Allergies</span>
          <p style={{ margin: '2px 0 10px' }}>{p.allergies || 'No known allergies'}</p>
          <span className="label">Notes</span>
          <p style={{ margin: '2px 0 10px', whiteSpace: 'pre-line' }}>{p.notes || 'No special notes.'}</p>
          <span className="label">NFC Tag</span>
          <p style={{ margin: '2px 0 0' }}>{p.tag ? <span className="badge"><Nfc aria-hidden /> {p.tag}</span> : <>No tag yet. <Link to={`/pets/${p.id}`}>Assign one</Link> on the pet’s page.</>}</p>
        </div>
      </div>
    </section>
  )
}

function Timeline({ a }) {
  const times = [['Booked', a.createdAt], ['Checked In', a.checkedInAt], ['Started', a.startedAt], ['Admitted', a.admittedAt], ['Dispense', a.dispenseAt], ['Checked Out', a.checkedOutAt], ['Cancelled', a.cancelledAt]].filter(([, t]) => t)
  return (
    <section className="card">
      <div className="card-head"><div><h2>Visit History</h2><p>Every step, who and when</p></div><History className="card-head-icon" aria-hidden /></div>
      <div className="card-pad">
        {a.source === 'legacy' ? (
          <p style={{ margin: 0 }}>Imported from the old system{a.legacyStatus ? `, where it showed as ${a.legacyStatus}` : ''}.{a.legacyUnclosed ? ' It was never closed there; the medical records import will settle whether the visit happened.' : ''}</p>
        ) : (
          <ul className="timeline">
            {a.history.map((h, i) => (
              <li key={i}>
                <strong>{STATUS[h.to]?.label || h.to}</strong>
                <span className="cell-sub">{prettyDay(h.at.slice(0, 10))} {clockTime(h.at)}{VIA[h.via]}{h.actor && h.via !== 'auto' ? ` · ${h.actor.replace(/ \((tag|undo)\)$/, '')}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
        {times.length > 1 && a.checkedInAt && a.checkedOutAt && (
          <p className="field-hint" style={{ margin: '10px 0 0' }}>In clinic for {Math.round((Date.parse(a.checkedOutAt) - Date.parse(a.checkedInAt)) / 60000)} minutes.</p>
        )}
      </div>
    </section>
  )
}

export default function AppointmentPage() {
  const { id } = useParams()
  const { data, error, setData, reload } = useApi(`appointments/${id}`)
  useAppointmentsChanged(reload)
  const [panel, setPanel] = useState(null)
  const toast = useToast()
  const navigate = useNavigate()
  const a = data?.appointment
  const crumbs = [{ label: 'Dashboard', to: '/' }, { label: 'Appointments', to: '/appointments' }, { label: 'Appointment Details' }]
  if (error) return <><PageHead crumbs={crumbs} title="Appointment" /><ErrorNote error={error} /></>
  if (!a) return <PageHead crumbs={crumbs} title=" " />
  const changed = (appointment, message) => {
    setData({ appointment })
    if (message) toast(message)
    appointmentsChanged()
  }
  const banners = [
    a.to && { icon: CalendarDays, title: 'New Appointment', text: `Rescheduled to ${prettyDay(a.to.day)}, ${prettyTime(a.to.time)}`, link: `/appointments/${a.to.id}`, no: a.to.no },
    a.from && { icon: CalendarClock, title: 'View Original Appointment', text: `This appointment was rescheduled${a.rescheduleReason ? `: ${a.rescheduleReason}` : ''}`, link: `/appointments/${a.from.id}`, no: a.from.no },
    a.legacyInfo && { icon: TriangleAlert, title: 'Note from the Old System', text: a.legacyInfo },
    a.reason && { icon: MessageSquare, title: a.kind === 'walk_in' ? 'Reason for the Visit' : 'Notes for the Visit', text: a.reason },
  ].filter(Boolean)

  return (
    <>
      <PageHead crumbs={crumbs} title={`${a.pet.name} · ${prettyDay(a.day)}`} />
      <div className="appt-layout">
        <div className="stack">
          <section className="card">
            <div className="card-head"><div><h2>Appointment</h2><p>#{a.no}</p></div></div>
            <div className="card-pad stack" style={{ gap: 10 }}>
              <div className="fact">
                <span className="appt-when"><CalendarDays aria-hidden /> {longDay(a.day)}</span>
                <span className="appt-when"><Clock aria-hidden /> {prettyTime(a.time)}</span>
              </div>
              <div className="chips">
                {a.kind === 'walk_in' && <span className="chip"><UserRound aria-hidden /> Walk-In</span>}
                {a.from && <span className="chip"><CalendarClock aria-hidden /> Rescheduled Appointment</span>}
                {a.source === 'legacy' && <span className="chip">From the Old System</span>}
                {a.bookedBy && <span className="chip">Booked by {a.bookedBy}</span>}
              </div>
              {a.checkedInAt && <p style={{ margin: 0 }}>In {clockTime(a.checkedInAt)}{a.checkedOutAt ? ` · Out ${clockTime(a.checkedOutAt)}` : ''}</p>}
              {!['cancelled', 'no_show'].includes(a.status) && <WeightToday a={a} onChange={changed} />}
            </div>
          </section>
          <PetProfile a={a} />
        </div>

        <div className="stack">
          {banners.length > 0 && (
            <section className="card banners">
              {banners.map((b) => {
                const inner = <><b.icon aria-hidden /><span>{b.no && <span className="badge badge-soft">#{b.no}</span>} <strong>{b.title}</strong><span className="cell-sub">{b.text}</span></span>{b.link && <ArrowRight aria-hidden />}</>
                return b.link ? <Link key={b.title} to={b.link} className="banner">{inner}</Link> : <div key={b.title} className="banner">{inner}</div>
              })}
            </section>
          )}
          <div className="appt-top">
            <StatusControl a={a} onChange={changed} />
            <Actions a={a} onChange={changed} setPanel={setPanel} />
          </div>
          <div className="grid grid-2">
            <StaffCard key={a.staff.map((s) => s.id).join()} a={a} onChange={changed} />
            <Notes a={a} onChange={changed} />
          </div>
          <Items a={a} onChange={changed} />
          <VisitRecord petId={a.pet.id} day={a.day} showEmpty={['arrived', 'started', 'inpatient', 'dispense', 'completed'].includes(a.status)} />
          <Timeline a={a} />
        </div>
      </div>

      {panel === 'reschedule' && (
        <ReschedulePanel appointment={a} onClose={() => setPanel(null)}
          onDone={(n) => { setPanel(null); appointmentsChanged(); toast(`Rescheduled to ${prettyDay(n.day)}, ${prettyTime(n.time)}`); navigate(`/appointments/${n.id}`) }} />
      )}
      {panel === 'followup' && (
        <BookPanel pet={{ ...a.pet, owner: a.owner }} defaultDay={addDays(a.day, a.followUpDays || 7)} followUpOf={{ id: a.id, reason: a.followUpReason }} onClose={() => setPanel(null)}
          onDone={(n) => { setPanel(null); appointmentsChanged(); toast(`Follow-up booked for ${prettyDay(n.day)}, ${prettyTime(n.time)}`); reload() }} />
      )}
      {panel === 'cancel' && (
        <CancelPanel appointment={a} onClose={() => setPanel(null)} onDone={(n) => { setPanel(null); changed(n, 'Appointment cancelled') }} />
      )}
    </>
  )
}
