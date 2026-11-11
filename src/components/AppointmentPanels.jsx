import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Plus, Search, Siren, UserPlus, X } from 'lucide-react'
import { ErrorNote, Field, Panel, PetAvatar } from './ui.jsx'
import { api } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { age } from '../lib/format.js'
import { CANCEL_REASONS, STATUS, longDay, manilaToday, prettyTime, timeSlots } from '../lib/appointments.js'

export function StatusBadge({ status, emergency }) {
  const s = STATUS[status] || STATUS.accepted
  return (
    <span className="status-wrap">
      <span className={`badge status status-${s.tone}`}><s.icon aria-hidden /> {s.label}</span>
      {emergency && <span className="badge status status-urgent"><Siren aria-hidden /> Emergency</span>}
    </span>
  )
}

function fieldErrors(error) {
  return error?.body?.errors || {}
}

// --- Pet cards with a search box (old: "Pet Information" with "New user?") ---
export function PetPicker({ value, onPick }) {
  const [text, setText] = useState('')
  const q = useDebounced(text.trim())
  const { data, error, loading } = useApi(`pets?status=active${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="form-section-head">
        <h3>Pet Information</h3>
        <Link className="btn btn-dark" to="/clients?new=1"><UserPlus aria-hidden /> New Client?</Link>
      </div>
      <div className="search" style={{ maxWidth: 'none' }}>
        <Search aria-hidden />
        <label className="sr-only" htmlFor="pet-search">Search Pets</label>
        <input id="pet-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search pets, owners or mobile" autoComplete="off" />
      </div>
      <ErrorNote error={error} />
      {data && !data.pets.length && <p className="field-hint" style={{ margin: 0 }}>No pet matches “{text}”. Try the owner’s name, or register them with <strong>New Client?</strong></p>}
      <ul className="pet-cards" aria-busy={loading}>
        {(data?.pets || []).map((p) => (
          <li key={p.id}>
            <button type="button" className="pet-card" aria-pressed={value?.id === p.id} onClick={() => onPick(p)}>
              <PetAvatar species={p.species} />
              <span>
                <strong>{p.name}</strong>
                <span className="cell-sub">{[p.breed, p.species === 'cat' ? 'Cat' : p.species === 'dog' ? 'Dog' : null].filter(Boolean).join(' · ')}</span>
                <span className="cell-sub">{age(p.birthdate) || '—'}</span>
                <span className="cell-sub">{p.owner.name}</span>
              </span>
              {value?.id === p.id && <Check className="pet-card-tick" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Steps({ steps, at }) {
  return (
    <ol className="kiosk-steps panel-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
      {steps.map((label, i) => (
        <li key={label} className={i < at ? 'done' : i === at ? 'current' : ''}>
          <span className="kiosk-dot">{i < at ? <Check aria-hidden /> : i + 1}</span>
          <span className="kiosk-step-label">{label}</span>
        </li>
      ))}
    </ol>
  )
}

// --- Services: from the price list, or typed in (the list is still being filled in) ---
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export function ServicePicker({ items, setItems, products }) {
  const { data } = useApi('services/picker')
  const [other, setOther] = useState('')
  const [otherDetail, setOtherDetail] = useState('')
  const [find, setFind] = useState('')
  const groups = useMemo(() => {
    const words = find.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (...texts) => words.every((w) => texts.some((t) => String(t || '').toLowerCase().includes(w)))
    const g = {}
    for (const s of data?.services || []) {
      const options = [[s, null], ...s.variations.map((v) => [s, v])].filter(([, v]) => hit(s.category, s.name, v?.name))
      if (options.length) (g[s.category] ||= []).push(...options)
    }
    return Object.entries(g)
  }, [data, find])
  const has = (s, v) => items.some((i) => i.serviceId === s.id && (i.variationId || null) === (v?.id || null))
  const toggle = (s, v) => setItems(has(s, v)
    ? items.filter((i) => !(i.serviceId === s.id && (i.variationId || null) === (v?.id || null)))
    : [...items, { serviceId: s.id, variationId: v?.id || null, label: v ? `${s.name} · ${v.name}` : s.name }])
  function addOther() {
    const name = other.trim()
    if (!name) return
    setItems([...items, { name, detail: otherDetail.trim(), label: otherDetail.trim() ? `${name} · ${otherDetail.trim()}` : name }])
    setOther('')
    setOtherDetail('')
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      {items.length > 0 && (
        <div className="chips" aria-label="Chosen services">
          {items.map((i, n) => (
            <span key={n} className="chip">{i.label}
              <button type="button" className="chip-x" onClick={() => setItems(items.filter((_, k) => k !== n))} aria-label={`Remove ${i.label}`}><X /></button>
            </span>
          ))}
        </div>
      )}
      {(data?.services || []).length > 0 && (
        <div className="search" style={{ maxWidth: 'none' }}>
          <Search aria-hidden />
          <label className="sr-only" htmlFor="svc-search">Search Services</label>
          <input id="svc-search" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search services, e.g. rabies or dental" autoComplete="off" />
        </div>
      )}
      {find && !groups.length && <p className="field-hint" style={{ margin: 0 }}>No service matches “{find}”. Type it under Other Service below.</p>}
      {groups.map(([category, options]) => (
        <section key={category} className="form-section">
          <h3 className="label">{category}</h3>
          <div className="choice-grid">
            {options.map(([s, v]) => (
              <button key={`${s.id}-${v?.id || 0}`} type="button" className="choice" aria-pressed={has(s, v)} onClick={() => toggle(s, v)}>
                <strong>{v ? v.name : s.name}</strong>
                <span className="cell-sub">{v ? s.name : s.variations.length ? 'Base price' : null} {peso(v ? v.price : s.price)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <section className="form-section">
        <h3 className="label">Other Service</h3>
        <p className="field-hint" style={{ margin: 0 }}>Not on the list yet? Type it, e.g. Vaccine · Anti Rabies.</p>
        <div className="form-row">
          <Field label="Service">{(a) => <input {...a} value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOther()} placeholder="e.g. VACCINE" />}</Field>
          <Field label="Type or Package" optional>{(a) => <input {...a} value={otherDetail} onChange={(e) => setOtherDetail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOther()} placeholder="e.g. ANTI RABIES" />}</Field>
        </div>
        <button type="button" className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={addOther} disabled={!other.trim()}><Plus aria-hidden /> Add Service</button>
      </section>
      {products && <MedicineFields onAdd={(it) => setItems([...items, it])} />}
    </div>
  )
}

// Medicines and products given or dispensed (no stock list yet, so they're typed).
function MedicineFields({ onAdd }) {
  const [name, setName] = useState('')
  const [how, setHow] = useState('')
  const [qty, setQty] = useState('1')
  function add() {
    if (!name.trim()) return
    const q = Math.max(1, Math.min(99, Number(qty) || 1))
    onAdd({ kind: 'product', name: name.trim(), detail: how.trim(), qty: q, label: `${name.trim()}${how.trim() ? ` · ${how.trim()}` : ''}${q > 1 ? ` × ${q}` : ''}` })
    setName(''); setHow(''); setQty('1')
  }
  return (
    <section className="form-section">
      <h3 className="label">Medicine or Product</h3>
      <p className="field-hint" style={{ margin: 0 }}>What was given or dispensed, e.g. Prednisone 20mg · ½ tab twice a day for 3 days.</p>
      <div className="form-row">
        <Field label="Medicine or Product">{(a) => <input {...a} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Prednisone 20mg" />}</Field>
        <Field label="Dose or Instructions" optional>{(a) => <input {...a} value={how} onChange={(e) => setHow(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. ½ tab twice a day, 3 days" />}</Field>
      </div>
      <div className="inline-row" style={{ maxWidth: 320 }}>
        <Field label="Quantity">{(a) => <input {...a} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" maxLength={2} style={{ width: 80 }} />}</Field>
        <button type="button" className="btn btn-quiet" style={{ alignSelf: 'end' }} onClick={add} disabled={!name.trim()}><Plus aria-hidden /> Add Medicine</button>
      </div>
    </section>
  )
}

export function StaffSelect({ value, onChange }) {
  const { data } = useApi('staff/directory')
  const staff = data?.staff || []
  const toggle = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  return (
    <div className="choice-grid" role="group" aria-label="Staff">
      {staff.map((s) => (
        <button key={s.id} type="button" className="choice" aria-pressed={value.includes(s.id)} onClick={() => toggle(s.id)}>
          <strong>{s.name}</strong>
          <span className="cell-sub">{s.title || { vet: 'Veterinarian', owner: 'Owner', front_desk: 'Front Desk', groomer: 'Groomer', admin: 'Admin' }[s.role]}</span>
        </button>
      ))}
    </div>
  )
}

// --- Day and time, with how busy that day already is ---
function ScheduleFields({ day, time, setDay, setTime, errors }) {
  const clinic = useApi('clinic').data?.clinic
  const busy = useApi(day ? `appointments?from=${day}&to=${day}&size=1` : null)
  const slots = day ? timeSlots(day, clinic?.hours) : []
  useEffect(() => { if (time && slots.length && !slots.includes(time)) setTime('') }, [day]) // eslint-disable-line react-hooks/exhaustive-deps
  const booked = busy.data ? busy.data.tabs.all - busy.data.tabs.cancelled : null
  return (
    <div className="form-row">
      <Field label="Day" error={errors.day} hint={day ? `${longDay(day)}${booked != null ? ` · ${booked} booked` : ''}` : undefined}>
        {(a) => <input {...a} type="date" min={manilaToday()} value={day} onChange={(e) => setDay(e.target.value)} />}
      </Field>
      <Field label="Time" error={errors.time} hint={day && !slots.length ? 'The clinic is closed that day. Pick another day.' : undefined}>
        {(a) => (
          <select {...a} value={time} onChange={(e) => setTime(e.target.value)} disabled={!slots.length}>
            <option value="">Choose a time</option>
            {slots.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
          </select>
        )}
      </Field>
    </div>
  )
}

// --- Book Appointment: Pet → Services → Schedule (the old 3-step panel) ---
export function BookPanel({ pet: givenPet, defaultDay, followUpOf, onClose, onDone }) {
  const [step, setStep] = useState(givenPet ? 1 : 0)
  const [pet, setPet] = useState(givenPet || null)
  const [items, setItems] = useState([])
  const [day, setDay] = useState(defaultDay && defaultDay > manilaToday() ? defaultDay : manilaToday())
  const [time, setTime] = useState('')
  const [reason, setReason] = useState(followUpOf?.reason ? `Follow-up: ${followUpOf.reason}` : followUpOf ? 'Follow-up' : '')
  const [staffIds, setStaffIds] = useState([])
  const [emergency, setEmergency] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = fieldErrors(error)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api('appointments', { method: 'POST', body: { petId: pet.id, day, time, items, reason, staffIds, emergency, followUpOf: followUpOf?.id } })
      onDone(res.appointment)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const next = [
    <button key="n" type="button" className="btn" disabled={!pet} onClick={() => setStep(1)}>Next: Select Services <ArrowRight aria-hidden /></button>,
    <button key="n" type="button" className="btn" onClick={() => setStep(2)}>{items.length ? 'Next: Schedule' : 'Skip: No Services Yet'} <ArrowRight aria-hidden /></button>,
    <button key="n" type="button" className="btn" disabled={busy || !day || !time} onClick={save}>{busy ? 'Booking…' : 'Book Appointment'}</button>,
  ][step]
  return (
    <Panel title="Book Appointment" intro={['Select the pet', pet ? `Services for ${pet.name}` : 'Services', pet ? `When ${pet.name} is coming in` : 'Schedule'][step]}
      onClose={onClose} busy={busy}
      footer={<>{step > 0 && !(givenPet && step === 1) && <button type="button" className="btn btn-quiet" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}{next}</>}>
      <Steps steps={['Pet', 'Services', 'Schedule']} at={step} />
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      {step === 0 && <PetPicker value={pet} onPick={(p) => { setPet(p); setStep(1) }} />}
      {step === 1 && <ServicePicker items={items} setItems={setItems} />}
      {step === 2 && (
        <>
          <section className="form-section">
            <ScheduleFields day={day} time={time} setDay={setDay} setTime={setTime} errors={errors} />
            <Field label="Notes for the Visit" optional hint="What the owner said, e.g. limping since Sunday.">
              {(a) => <textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
            </Field>
            <label className="check"><input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} /> Mark as Emergency</label>
          </section>
          <section className="form-section">
            <h3 className="label">Assign Staff <small>(optional)</small></h3>
            <StaffSelect value={staffIds} onChange={setStaffIds} />
          </section>
        </>
      )}
    </Panel>
  )
}

// --- Walk-In Check In: the pet is here now, with no booking ---
export function WalkInPanel({ pet: givenPet, admit, onClose, onDone }) {
  const [pet, setPet] = useState(givenPet || null)
  const [items, setItems] = useState([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api('appointments', { method: 'POST', body: { petId: pet.id, walkIn: true, admit: !!admit, items, reason } })
      onDone(res.appointment)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel title={admit ? 'Admit Inpatient' : 'Walk-In Check In'} intro={admit ? 'Checks the pet in and admits them now, for confinement or recovery. Tap the tag when they go home.' : "Creates the visit now, already Arrived. Tap the pet's tag on the way out to close it."}
      onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy || !pet}>{busy ? 'Saving…' : admit ? (pet ? `Admit ${pet.name}` : 'Admit Now') : pet ? `Check In ${pet.name}` : 'Check In Now'}</button></>}>
      <ErrorNote error={error} />
      {pet && givenPet ? (
        <div className="setting-line"><PetAvatar species={pet.species} /><div><strong>{pet.name}</strong><span className="cell-sub">{pet.owner?.name || pet.ownerName}</span></div></div>
      ) : <PetPicker value={pet} onPick={setPet} />}
      {pet && (
        <>
          <section className="form-section">
            <Field label="Reason for the Visit" optional>{(a) => <input {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. vomiting since this morning" />}</Field>
          </section>
          <details className="form-section">
            <summary><strong>Add Services Now</strong> <span className="cell-sub">Optional: the vet can add them later</span></summary>
            <ServicePicker items={items} setItems={setItems} />
          </details>
        </>
      )}
    </Panel>
  )
}

export function ReschedulePanel({ appointment: a, onClose, onDone }) {
  const [day, setDay] = useState(a.day >= manilaToday() ? a.day : manilaToday())
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = fieldErrors(error)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`appointments/${a.id}/reschedule`, { method: 'POST', body: { day, time, reason } })
      onDone(res.appointment)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel title={`Reschedule ${a.pet.name}`} intro={`Now: ${longDay(a.day)}, ${prettyTime(a.time)}. This one is cancelled and a new appointment is booked, linked to it.`}
      onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Keep It</button>
        <button type="button" className="btn" onClick={save} disabled={busy || !day || !time}>{busy ? 'Rescheduling…' : 'Reschedule'}</button></>}>
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <section className="form-section">
        <ScheduleFields day={day} time={time} setDay={setDay} setTime={setTime} errors={errors} />
        <Field label="Reason for Rescheduling" optional>{(a2) => <input {...a2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Owner asked for the weekend" />}</Field>
      </section>
    </Panel>
  )
}

export function CancelPanel({ appointment: a, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const text = reason === 'other' ? other.trim() : reason
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`appointments/${a.id}/cancel`, { method: 'POST', body: { reason: text } })
      onDone(res.appointment)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel title={`Cancel ${a.pet.name}’s Appointment`} intro={`${longDay(a.day)}, ${prettyTime(a.time)}`} onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Keep It</button>
        <button type="button" className="btn btn-dark" onClick={save} disabled={busy || !text}>{busy ? 'Cancelling…' : 'Cancel Appointment'}</button></>}>
      <ErrorNote error={error} />
      <section className="form-section">
        <span className="field-label">Reason</span>
        <div className="seg seg-stack" role="radiogroup" aria-label="Reason">
          {[...CANCEL_REASONS, 'other'].map((r) => (
            <label key={r}><input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} /><span>{r === 'other' ? 'Other' : r}</span></label>
          ))}
        </div>
        {reason === 'other' && <Field label="Other Reason">{(a2) => <input {...a2} value={other} onChange={(e) => setOther(e.target.value)} maxLength={200} autoFocus />}</Field>}
        <p className="field-hint" style={{ margin: 0 }}>If the owner wants another day, use <strong>Reschedule</strong> instead, so the two stay linked.</p>
      </section>
    </Panel>
  )
}
