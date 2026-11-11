import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, Plus, Search, Siren, UserPlus, X } from 'lucide-react'
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
      <div className="sticky-search">
        <div className="search" style={{ maxWidth: 'none' }}>
          <Search aria-hidden />
          <label className="sr-only" htmlFor="pet-search">Search Pets</label>
          <input id="pet-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search pets, owners or mobile" autoComplete="off" />
        </div>
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
  // The 3 services used most on visits lately (from the server), shown above the full list.
  const popular = useMemo(() => (data?.popular || []).map((p) => {
    const s = (data.services || []).find((x) => x.id === p.serviceId)
    const v = s && p.variationId ? s.variations.find((x) => x.id === p.variationId) : null
    return s && (!p.variationId || v) ? [s, v] : null
  }).filter(Boolean), [data])
  const shown = useMemo(() => {
    const words = find.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (s) => words.every((w) => [s.name, s.category, s.description, ...s.variations.map((v) => v.name)].some((t) => String(t || '').toLowerCase().includes(w)))
    return (data?.services || []).filter(hit)
  }, [data, find])
  const has = (s, v) => items.some((i) => i.serviceId === s.id && (i.variationId || null) === (v?.id || null))
  // Updates from the latest list, so "All" can tick several variations in one go.
  const toggle = (s, v) => setItems((prev) => {
    const same = (i) => i.serviceId === s.id && (i.variationId || null) === (v?.id || null)
    return prev.some(same) ? prev.filter((i) => !same(i)) : [...prev, { serviceId: s.id, variationId: v?.id || null, label: v ? `${s.name} · ${v.name}` : s.name }]
  })
  function addOther() {
    const name = other.trim()
    if (!name) return
    setItems([...items, { name, detail: otherDetail.trim(), label: otherDetail.trim() ? `${name} · ${otherDetail.trim()}` : name }])
    setOther('')
    setOtherDetail('')
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="sticky-search">
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
      </div>
      {!find && popular.length > 0 && (
        <section className="form-section popular">
          <h3 className="label">Most Popular</h3>
          <div className="choice-grid">
            {popular.map(([s, v]) => (
              <button key={`p-${s.id}-${v?.id || 0}`} type="button" className="choice" aria-pressed={has(s, v)} onClick={() => toggle(s, v)}>
                <strong>{v ? v.name : s.name}</strong>
                <span className="cell-sub">{v ? s.name : s.variations.length ? 'Base price' : null} {peso(v ? v.price : s.price)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {find && !shown.length && <p className="field-hint" style={{ margin: 0 }}>No service matches “{find}”. Type it under Other Service below.</p>}
      {shown.length > 0 && (
        <div className="svc-grid">
          {shown.map((s) => <ServiceCard key={s.id} s={s} has={has} toggle={toggle} />)}
        </div>
      )}
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

// One service, like the old picker: the circle picks the service itself (base price); a service with
// variations has "Choose variations", a list with search, All and a checkbox per variation.
function ServiceCard({ s, has, toggle }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  const picked = s.variations.filter((v) => has(s, v))
  const listed = s.variations.filter((v) => v.name.toLowerCase().includes(q.trim().toLowerCase()))
  const allOn = listed.length > 0 && listed.every((v) => has(s, v))
  const setAll = () => listed.forEach((v) => { if (has(s, v) === allOn) toggle(s, v) })
  return (
    <div className={`svc-card ${has(s, null) || picked.length ? 'is-picked' : ''}`}>
      <div className="svc-card-head">
        <div>
          <strong>{s.name}</strong>
          <span className="badge badge-soft svc-cat">{s.category}</span>
        </div>
        <button type="button" className="svc-radio" role="checkbox" aria-checked={has(s, null)} onClick={() => toggle(s, null)}
          aria-label={`${s.name}${s.variations.length ? ' (base price)' : ''} ${peso(s.price)}`} title={`${s.variations.length ? 'Base price' : 'Pick'}: ${peso(s.price)}`}>
          {has(s, null) && <Check aria-hidden />}
        </button>
      </div>
      {s.description && <p className="svc-desc">{s.description}</p>}
      <div className="svc-foot">
        {s.variations.length ? (
          <div className="svc-vars" ref={box}>
            <span className="cell-sub">Select Variations (Multiple allowed)</span>
            <button type="button" className="svc-select" onClick={() => setOpen(!open)} aria-expanded={open}>
              <span>{picked.length ? picked.map((v) => v.name).join(', ') : 'Choose variations'}</span>
              <ChevronDown aria-hidden />
            </button>
            {open && (
              <div className="svc-pop card" role="listbox" aria-multiselectable="true" aria-label={`${s.name} variations`}>
                {s.variations.length > 5 && (
                  <div className="search svc-pop-search"><Search aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search variations" autoFocus /></div>
                )}
                <label className="svc-opt svc-all"><input type="checkbox" checked={allOn} onChange={setAll} /> <span>All</span> <span className="cell-sub">({listed.length})</span></label>
                {listed.map((v) => (
                  <label key={v.id} className="svc-opt"><input type="checkbox" checked={has(s, v)} onChange={() => toggle(s, v)} /> <span>{v.name}</span> <span className="cell-sub">{peso(v.price)}</span></label>
                ))}
                <button type="button" className="svc-close" onClick={() => setOpen(false)}>Close</button>
              </div>
            )}
          </div>
        ) : <span className="cell-sub">Standard service · {peso(s.price)}</span>}
      </div>
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
  const [startReason] = useState(followUpOf?.reason ? `Follow-up: ${followUpOf.reason}` : followUpOf ? 'Follow-up' : '')
  const [reason, setReason] = useState(startReason)
  const [staffIds, setStaffIds] = useState([])
  const [emergency, setEmergency] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = fieldErrors(error)
  const bookDirty = (!givenPet && !!pet) || items.length > 0 || !!time || reason !== startReason || emergency || staffIds.length > 0

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
    <Panel dirty={bookDirty} discardTitle="Discard this booking?" title="Book Appointment" intro={['Select the pet', pet ? `Services for ${pet.name}` : 'Services', pet ? `When ${pet.name} is coming in` : 'Schedule'][step]}
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
    <Panel dirty={(!givenPet && !!pet) || items.length > 0 || !!reason.trim()} discardTitle={admit ? 'Discard this admission?' : 'Discard this walk-in?'} title={admit ? 'Admit Inpatient' : 'Walk-In Check In'} intro={admit ? 'Checks the pet in and admits them now, for confinement or recovery. Tap the tag when they go home.' : "Creates the visit now, already Arrived. Tap the pet's tag on the way out to close it."}
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
    <Panel dirty={!!time || !!reason.trim()} discardTitle="Discard the new date and time?" title={`Reschedule ${a.pet.name}`} intro={`Now: ${longDay(a.day)}, ${prettyTime(a.time)}. This one is cancelled and a new appointment is booked, linked to it.`}
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
    <Panel dirty={!!reason} discardTitle="Close without cancelling the appointment?" title={`Cancel ${a.pet.name}’s Appointment`} intro={`${longDay(a.day)}, ${prettyTime(a.time)}`} onClose={onClose} busy={busy}
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
