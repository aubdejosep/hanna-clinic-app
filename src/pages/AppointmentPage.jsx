import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Ban, CalendarClock, ChevronDown, Wallet, CalendarDays, CircleX, Clock, History, MessageSquare, Nfc, Plus, Siren, Stethoscope, Trash2, TriangleAlert, Undo2, User, UserRound } from 'lucide-react'
import { ErrorNote, Field, PageHead, Panel, PetAvatar, useToast, PawLoader } from '../components/ui.jsx'
import { BookPanel, CancelPanel, ReschedulePanel, ServicePicker, StatusBadge } from '../components/AppointmentPanels.jsx'
import { METHOD_LABEL, PaymentPanel, peso, toSend } from '../components/QuickAdd.jsx'
import { appointmentsChanged, useAppointmentsChanged } from '../components/TagCheckIn.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { age, prettyDay, SEX_LABEL, SPECIES_LABEL } from '../lib/format.js'
import { ACTIONS, STATUS, addDays, clockTime, longDay, prettyTime } from '../lib/appointments.js'
import { canManage, ROLE_LABEL, useStaff } from '../lib/staff.js'
import { useVisitMedical } from '../components/VisitRecord.jsx'

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

function StatusControl({ a, onChange, setPanel }) {
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
      <div className="card-head"><div><h2>Status Control</h2><p>Appointment progress</p></div>
        <div className="head-actions"><StatusBadge status={a.status} emergency={a.emergency} />
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPanel('timeline')} title="Every step, who and when"><History aria-hidden /> History</button></div></div>
      <div className="card-pad stack">
        {closed ? (
          <div className="alert" role="note">
            <CircleX aria-hidden />
            <span>{a.status === 'cancelled' ? <>Cancelled{a.cancelReason ? `: ${a.cancelReason}` : ''}.</> : <>No Show: nobody tapped in for this booking on the day.</>}</span>
          </div>
        ) : <Stepper a={a} />}
        <ErrorNote error={error} />
        {(actions.length > 0 || a.canUndo || a.status === 'completed') && (
          <div className="status-actions">
            {actions.map(([to, label, hint], i) => (
              <button key={to} type="button" className={`btn ${i === 0 ? '' : 'btn-quiet'}`} onClick={() => (to === 'completed' && a.paymentStatus !== 'paid' && a.paymentStatus !== 'not_tracked' ? setPanel('pay') : go({ to }, to))} disabled={!!busy} title={hint || undefined}>
                {busy === to ? 'Saving…' : label} {i === 0 && <ArrowRight aria-hidden />}
              </button>
            ))}
            {a.status === 'completed' && <span className="cell-sub">Visit closed{a.checkedOutAt ? ` at ${clockTime(a.checkedOutAt)}` : ''}. To correct anything, add a Staff Note.</span>}
            {a.canUndo && (
              <button type="button" className="text-btn" onClick={() => go({ undo: true }, 'undo')} disabled={!!busy}>
                <Undo2 size={14} aria-hidden /> {busy === 'undo' ? 'Undoing…' : 'Undo Last Step'}
              </button>
            )}
          </div>
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
      <div className="card-head"><div><h2>Appointment Actions</h2><p>{!canSchedule && !canCancel ? (a.status === 'completed' ? 'This visit is closed.' : a.status === 'cancelled' ? 'This appointment is cancelled.' : 'The visit has started, so it can’t be moved now.') : 'Emergency, schedule and follow-up'}</p></div></div>
      <div className="card-pad stack" style={{ gap: 10 }}>
        <div className="action-row">
          <button type="button" className={`btn btn-sm ${a.emergency ? 'btn-dark' : 'btn-quiet'}`} onClick={emergency} disabled={busy || a.status === 'cancelled'}>
            <Siren aria-hidden /> {a.emergency ? 'Remove Emergency' : 'Emergency'}
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPanel('reschedule')} disabled={!canSchedule}><CalendarClock aria-hidden /> Reschedule</button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPanel('cancel')} disabled={!canCancel}><CircleX aria-hidden /> Cancel</button>
        </div>
        {!['cancelled', 'no_show', 'pending', 'accepted'].includes(a.status) && <FollowUp a={a} onChange={onChange} setPanel={setPanel} />}
      </div>
    </section>
  )
}

// Staff for this visit, picked from a short list at the top of the page (saved as you tick).
function StaffPicker({ a, onChange }) {
  const { data } = useApi('staff/directory')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const ids = a.staff.map((s) => s.id)
  async function toggle(id) {
    setBusy(true)
    try {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
      const res = await api(`appointments/${a.id}`, { method: 'PATCH', body: { staffIds: next } })
      onChange(res.appointment, 'Staff saved')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="staff-picker" ref={box}>
      <span className="field-label">Staff</span>
      <button type="button" className="staff-picker-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Stethoscope aria-hidden />
        <span>{a.staff.length ? a.staff.map((s) => s.name).join(', ') : 'Assign staff'}</span>
        <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="staff-pop card" role="group" aria-label="Staff for this visit">
          {(data?.staff || []).map((s) => (
            <label key={s.id} className="svc-opt"><input type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} disabled={busy} />
              <span>{s.name}</span><span className="cell-sub">{s.title || ROLE_LABEL[s.role] || s.role}</span></label>
          ))}
          {!data && <span className="cell-sub">Loading…</span>}
        </div>
      )}
    </div>
  )
}

// The top of the page: the pet and owner, when, the staff, and today's weight, in one row.
function VisitBar({ a, onChange }) {
  const p = a.pet
  return (
    <section className="card visit-bar">
      <div className="vb-pet">
        <PetAvatar species={p.species} />
        <div className="vb-text">
          <Link to={`/pets/${p.id}`} className="vb-name">{p.name}</Link>
          <span className="cell-sub">{[SPECIES_LABEL[p.species], p.breed, SEX_LABEL[p.sex], age(p.birthdate)].filter(Boolean).join(' · ')}</span>
          <span className="cell-sub"><User size={12} aria-hidden /> <Link to={`/clients/${a.owner.id}`}>{a.owner.name}</Link>{a.owner.mobileLocal && <> · <a href={`tel:${a.owner.mobile}`}>{a.owner.mobileLocal}</a></>}</span>
          <span className="vb-chips">
            {p.allergies && <span className="badge badge-warn" title={p.allergies}><TriangleAlert aria-hidden /> Allergies: {p.allergies}</span>}
            {p.tag ? <span className="badge badge-soft"><Nfc aria-hidden /> {p.tag}</span> : <Link className="cell-sub" to={`/pets/${p.id}`}>No NFC tag</Link>}
          </span>
          {p.notes && <span className="cell-sub vb-notes" title={p.notes}>Pet notes: {p.notes}</span>}
        </div>
      </div>
      <div className="vb-when">
        <span className="appt-when"><CalendarDays aria-hidden /> {longDay(a.day)}</span>
        <span className="appt-when"><Clock aria-hidden /> {prettyTime(a.time)}<span className="cell-sub">#{a.no}</span></span>
        <span className="vb-chips">
          {a.kind === 'walk_in' && <span className="chip"><UserRound aria-hidden /> Walk-In</span>}
          {a.from && <span className="chip"><CalendarClock aria-hidden /> Rescheduled</span>}
          {a.source === 'legacy' && <span className="chip">From the Old System</span>}
          {a.bookedBy && <span className="chip">Booked by {a.bookedBy}</span>}
        </span>
        {a.checkedInAt && <span className="cell-sub">In {clockTime(a.checkedInAt)}{a.checkedOutAt ? ` · Out ${clockTime(a.checkedOutAt)}` : ''}</span>}
      </div>
      <div className="vb-side">
        <StaffPicker a={a} onChange={onChange} />
        {!['cancelled', 'no_show'].includes(a.status) && <WeightToday a={a} onChange={onChange} />}
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
    if (!text.trim()) return
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
      <div className="card-head"><div><h2>Staff Notes</h2><p>{a.notes.length ? `${a.notes.length} note${a.notes.length === 1 ? '' : 's'} · ` : ''}Only clinic staff see these</p></div></div>
      <div className="card-pad stack" style={{ gap: 10 }}>
        <ErrorNote error={error} />
        <div className="inline-row">
          <label className="sr-only" htmlFor="staff-note">Add a Note</label>
          <input id="staff-note" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} maxLength={2000} placeholder="Add a note, e.g. owner will pick up at 5" />
          <button type="button" className="btn btn-sm btn-quiet" onClick={add} disabled={busy || !text.trim()}><MessageSquare aria-hidden /> {busy ? 'Adding…' : 'Add'}</button>
        </div>
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

function Items({ a, onChange, setPanel }) {
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`appointments/${a.id}/items`, { method: 'POST', body: { items: toSend(picked) } })
      onChange(res.appointment, `${picked.length} added`)
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
        <div><h2>Services &amp; Payment</h2><p>{a.items.length} item{a.items.length === 1 ? '' : 's'} · total {peso(a.due)}</p></div>
        {a.status !== 'cancelled' && <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}><Plus aria-hidden /> Add Items</button>}
      </div>
      {a.items.length ? (
        <table className="table table-compact">
          <thead><tr><th>Item</th><th className="num">Price</th><th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {a.items.map((it) => (
              <tr key={it.id} style={{ cursor: 'default' }}>
                <td><strong>{it.name}</strong>
                  <span className="cell-sub">{[it.detail, it.kind === 'product' ? `Product${it.qty !== 1 ? ` × ${it.qty}` : ''}` : it.qty !== 1 ? `× ${it.qty}` : null].filter(Boolean).join(' · ')}</span></td>
                <td data-label="Price" className="num">{it.price != null ? peso(it.price * (it.qty || 1)) : '—'}</td>
                <td className="row-action">{a.status !== 'cancelled' && <button type="button" className="icon-btn" onClick={() => remove(it)} aria-label={`Remove ${it.name}`} title="Remove"><Trash2 /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="no-hover"><td><strong>Total</strong></td><td className="num" data-label="Total"><strong>{peso(a.due)}</strong></td><td /></tr></tfoot>
        </table>
      ) : <p className="card-pad muted" style={{ margin: 0 }}>No services yet. Add what was done during the visit.</p>}
      <PaymentLine a={a} setPanel={setPanel} />
      {adding && (
        <Panel dirty={picked.length > 0} discardTitle="Discard the items you picked?" title="Add Services & Products" intro={`${a.pet.name} · ${prettyDay(a.day)}`} onClose={() => setAdding(false)} busy={busy}
          footer={<><button type="button" className="btn btn-quiet" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn" onClick={save} disabled={busy || !picked.length}>{busy ? 'Adding…' : `Add ${picked.length || ''} Item${picked.length === 1 ? '' : 's'}`}</button></>}>
          <ErrorNote error={error} />
          <ServicePicker items={picked} setItems={setPicked} products appointmentId={a.id} existing={a.items} onWeightSaved={(n) => onChange(n)} />
        </Panel>
      )}
    </section>
  )
}

// Payment, as the footer of Services & Products: paid (how, by whom) or Take Payment; owners can void.
function PaymentLine({ a, setPanel }) {
  const staff = useStaff()
  if (['cancelled', 'no_show', 'accepted', 'pending'].includes(a.status) && !a.payments.length) return null
  const live = a.payments.find((p) => !p.voidedAt)
  const voided = a.payments.filter((p) => p.voidedAt)
  return (
    <div className="pay-line">
      <Wallet aria-hidden />
      <div className="pay-line-text">
        {live ? (
          <>
            <strong>Paid {peso(live.amount)} · {METHOD_LABEL[live.method]}{live.reference ? ` · Ref ${live.reference}` : ''}</strong>
            <span className="cell-sub">{live.by} · {prettyDay(live.at.slice(0, 10))}{live.amount !== live.due ? ` · total was ${peso(live.due)}` : ''}{live.note ? ` · ${live.note}` : ''} · {a.stockDeductedAt ? 'taken off stock' : 'stock comes off at check-out'}</span>
          </>
        ) : a.paymentStatus === 'not_tracked' ? <strong>From before payments were recorded in the app</strong> : <strong>Not paid yet</strong>}
        {voided.length > 0 && <span className="cell-sub">{voided.length} voided: {voided.map((p) => `${peso(p.amount)} by ${p.voidedBy} (${p.voidReason})`).join('; ')}</span>}
      </div>
      {a.paymentStatus === 'unpaid' && <button type="button" className="btn btn-sm" onClick={() => setPanel('pay')}><Wallet aria-hidden /> Take Payment</button>}
      {live && canManage(staff) && <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPanel('void')}><Ban aria-hidden /> Void</button>}
    </div>
  )
}

function VoidPanel({ a, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`appointments/${a.id}/pay`, { method: 'DELETE', body: { reason } })
      onDone(res.appointment)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel dirty={!!reason.trim()} title="Void Payment" intro={`${a.pet.name} · ${prettyDay(a.day)}. The visit goes back to unpaid and its stock goes back on the shelf until it's paid again.`} onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Keep It</button>
        <button type="button" className="btn btn-dark" onClick={save} disabled={busy || !reason.trim()}>{busy ? 'Voiding…' : 'Void Payment'}</button></>}>
      <ErrorNote error={error && !error.body?.errors ? error : null} />
      <section className="form-section">
        <Field label="Reason" error={error?.body?.errors?.reason}>{(f) => <input {...f} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. charged the wrong pet" autoFocus />}</Field>
      </section>
    </Panel>
  )
}

// Every step of the visit, who and when (opened from Status Control's History button).
function TimelinePanel({ a, onClose }) {
  return (
    <Panel title="Visit History" intro={`${a.pet.name} · ${prettyDay(a.day)} · #${a.no}`} onClose={onClose}>
      <section className="form-section">
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
        {a.checkedInAt && a.checkedOutAt && (
          <p className="field-hint" style={{ margin: 0 }}>In clinic for {Math.round((Date.parse(a.checkedOutAt) - Date.parse(a.checkedInAt)) / 60000)} minutes.</p>
        )}
      </section>
    </Panel>
  )
}

// The page as a grid of rows; the cards in a row share its height, so there are no holes:
//   1  header (wide)              | Appointment Actions
//   2  Status Control             | Medical Record, Staff Notes, the latest Medical History
//   3  Services & Payment         |   (one stack beside rows 2 and 3; View All opens the whole history)
// The visit timeline and the full history open in panels. On narrow screens it's one column.
function AppointmentBody({ a, changed, reload, toast, setPanel, banners }) {
  const med = useVisitMedical({ a, onVisitChanged: reload, toast })
  return (
    <div className="appt-grid">
      <div className="ag-head stack">
        <VisitBar a={a} onChange={changed} />
        {banners.length > 0 && (
          <section className="card banners">
            {banners.map((b) => {
              const inner = <><b.icon aria-hidden /><span>{b.no && <span className="badge badge-soft">#{b.no}</span>} <strong>{b.title}</strong><span className="cell-sub">{b.text}</span></span>{b.link && <ArrowRight aria-hidden />}</>
              return b.link ? <Link key={b.title} to={b.link} className="banner">{inner}</Link>
                : b.onClick ? <button key={b.title} type="button" className="banner banner-action" onClick={b.onClick}>{inner}<ArrowRight aria-hidden /></button>
                : <div key={b.title} className="banner">{inner}</div>
            })}
          </section>
        )}
      </div>
      <div className="ag-actions"><Actions a={a} onChange={changed} setPanel={setPanel} /></div>
      <div className="ag-status"><StatusControl a={a} onChange={changed} setPanel={setPanel} /></div>
      <div className="ag-bill"><Items a={a} onChange={changed} setPanel={setPanel} /></div>
      <div className="ag-side">
        {med.card}
        <Notes a={a} onChange={changed} />
        {med.history}
      </div>
      {med.overlays}
    </div>
  )
}

export default function AppointmentPage() {
  const { id } = useParams()
  const { data, error, setData, reload } = useApi(`appointments/${id}`)
  useAppointmentsChanged(reload)
  const [params, setParams] = useSearchParams()
  const [panel, setPanel] = useState(params.get('pay') ? 'pay' : params.get('followup') ? 'followup' : null)
  const toast = useToast()
  const closePanel = () => { setPanel(null); if (params.get('pay') || params.get('followup')) setParams({}, { replace: true }) }
  const navigate = useNavigate()
  const a = data?.appointment
  const crumbs = [{ label: 'Dashboard', to: '/' }, { label: 'Appointments', to: '/appointments' }, { label: 'Appointment Details' }]
  if (error) return <><PageHead crumbs={crumbs} title="Appointment" /><ErrorNote error={error} /></>
  if (!a) return <><PageHead crumbs={crumbs} title=" " /><PawLoader label="Loading the appointment…" /></>
  const changed = (appointment, message) => {
    setData({ appointment })
    if (message) toast(message)
    appointmentsChanged()
  }
  const banners = [
    a.to && { icon: CalendarDays, title: 'New Appointment', text: `Rescheduled to ${prettyDay(a.to.day)}, ${prettyTime(a.to.time)}`, link: `/appointments/${a.to.id}`, no: a.to.no },
    a.from && { icon: CalendarClock, title: 'View Original Appointment', text: `This appointment was rescheduled${a.rescheduleReason ? `: ${a.rescheduleReason}` : ''}`, link: `/appointments/${a.from.id}`, no: a.from.no },
    a.legacyInfo && { icon: TriangleAlert, title: 'Note from the Old System', text: a.legacyInfo },
    a.status === 'completed' && a.paymentStatus === 'unpaid' && { icon: Wallet, title: 'Take Payment', text: 'Checked out without a payment. Its medicines stay on the stock count until it is paid.', onClick: () => setPanel('pay') },
    a.reason && { icon: MessageSquare, title: a.kind === 'walk_in' ? 'Reason for the Visit' : 'Notes for the Visit', text: a.reason },
  ].filter(Boolean)

  return (
    <>
      <PageHead crumbs={crumbs} title={`${a.pet.name} · ${prettyDay(a.day)}`} />
      <AppointmentBody a={a} changed={changed} reload={reload} toast={toast} setPanel={setPanel} banners={banners} />

      {panel === 'reschedule' && (
        <ReschedulePanel appointment={a} onClose={() => setPanel(null)}
          onDone={(n) => { setPanel(null); appointmentsChanged(); toast(`Rescheduled to ${prettyDay(n.day)}, ${prettyTime(n.time)}`); navigate(`/appointments/${n.id}`) }} />
      )}
      {panel === 'followup' && (
        <BookPanel pet={{ ...a.pet, owner: a.owner }} defaultDay={addDays(a.day, a.followUpDays || 7)} followUpOf={{ id: a.id, reason: a.followUpReason, time: a.time, staffIds: a.staff.map((x) => x.id) }} onClose={closePanel}
          onDone={(n) => { closePanel(); appointmentsChanged(); toast(`Follow-up booked for ${prettyDay(n.day)}, ${prettyTime(n.time)}`); reload() }} />
      )}
      {panel === 'timeline' && <TimelinePanel a={a} onClose={closePanel} />}
      {panel === 'pay' && (
        <PaymentPanel appointmentId={a.id} onClose={closePanel} onDone={(n, msg) => { closePanel(); changed(n, msg) }} />
      )}
      {panel === 'void' && (
        <VoidPanel a={a} onClose={closePanel} onDone={(n) => { closePanel(); changed(n, 'Payment voided') }} />
      )}
      {panel === 'cancel' && (
        <CancelPanel appointment={a} onClose={() => setPanel(null)} onDone={(n) => { setPanel(null); changed(n, 'Appointment cancelled') }} />
      )}
    </>
  )
}
