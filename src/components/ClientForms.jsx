// Panels for registering and editing owners and pets.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, TriangleAlert } from 'lucide-react'
import { api, ApiError } from '../lib/api.js'
import { BREED_NAMES } from '../lib/breeds.js'
import { ErrorNote, Field, Panel } from './ui.jsx'

const blankPet = () => ({ name: '', species: 'dog', sex: 'unknown', breed: '', birthdate: '' })

function Seg({ name, value, options, onChange }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <label key={v}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

function OwnerFields({ value, set, errors }) {
  return (
    <>
      <Field label="Full name" error={errors.name}>
        {(a) => <input {...a} value={value.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" maxLength={100} />}
      </Field>
      <div className="form-row">
        <Field label="Mobile" hint="For appointment reminders by SMS. e.g. 0917 123 4567" error={errors.mobile}>
          {(a) => <input {...a} value={value.mobile} onChange={(e) => set({ mobile: e.target.value })} inputMode="tel" autoComplete="off" />}
        </Field>
        <Field label="Email" optional hint="Leave blank if they don't have one." error={errors.email}>
          {(a) => <input {...a} type="email" value={value.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" />}
        </Field>
      </div>
      <div className="form-row">
        <Field label="Additional owner" optional hint="Family member who also brings the pets in.">
          {(a) => <input {...a} value={value.additionalOwner} onChange={(e) => set({ additionalOwner: e.target.value })} maxLength={100} />}
        </Field>
        <Field label="Messenger name or link" optional>
          {(a) => <input {...a} value={value.messenger} onChange={(e) => set({ messenger: e.target.value })} maxLength={200} />}
        </Field>
      </div>
      <Field label="Address" optional>
        {(a) => <textarea {...a} value={value.address} onChange={(e) => set({ address: e.target.value })} rows={2} maxLength={300} />}
      </Field>
      <label className="check">
        <input type="checkbox" checked={value.remindersOptIn} onChange={(e) => set({ remindersOptIn: e.target.checked })} />
        <span>Send appointment reminders to this owner</span>
      </label>
    </>
  )
}

function PetFields({ value, set, errors = {}, idx = 0, full }) {
  return (
    <>
      <div className="form-row">
        <Field label="Pet's name" error={errors.name}>
          {(a) => <input {...a} value={value.name} onChange={(e) => set({ name: e.target.value })} maxLength={50} autoComplete="off" />}
        </Field>
        <Field label="Breed" optional hint="Pick from the list or type it.">
          {(a) => <input {...a} value={value.breed} onChange={(e) => set({ breed: e.target.value })} list="breed-names" maxLength={60} autoComplete="off" />}
        </Field>
      </div>
      <div className="form-row">
        <div className="field">
          <span>Species</span>
          <Seg name={`species-${idx}`} value={value.species} onChange={(species) => set({ species })} options={[['dog', 'Dog'], ['cat', 'Cat'], ['other', 'Other']]} />
        </div>
        <div className="field">
          <span>Sex</span>
          <Seg name={`sex-${idx}`} value={value.sex} onChange={(sex) => set({ sex })} options={[['male', 'Male'], ['female', 'Female'], ['unknown', 'Not sure']]} />
        </div>
      </div>
      <Field label="Birthdate" optional hint="An estimate is fine." error={errors.birthdate}>
        {(a) => <input {...a} type="date" value={value.birthdate} onChange={(e) => set({ birthdate: e.target.value })} max={new Date().toISOString().slice(0, 10)} />}
      </Field>
      {full && (
        <>
          <div className="form-row">
            <Field label="Colour and markings" optional>
              {(a) => <input {...a} value={value.colorMarkings} onChange={(e) => set({ colorMarkings: e.target.value })} maxLength={100} />}
            </Field>
            <Field label="Microchip number" optional>
              {(a) => <input {...a} value={value.microchip} onChange={(e) => set({ microchip: e.target.value })} inputMode="numeric" maxLength={30} />}
            </Field>
          </div>
          <Field label="Allergies" optional hint="Shown in orange on the pet's page and appointments.">
            {(a) => <textarea {...a} value={value.allergies} onChange={(e) => set({ allergies: e.target.value })} rows={2} maxLength={500} />}
          </Field>
          <Field label="Notes" optional>
            {(a) => <textarea {...a} value={value.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} maxLength={2000} />}
          </Field>
        </>
      )}
    </>
  )
}

const BreedList = () => (
  <datalist id="breed-names">{BREED_NAMES.map((b) => <option key={b} value={b} />)}</datalist>
)

function fieldErrors(err, prefix = '') {
  const out = {}
  if (err instanceof ApiError && err.body.errors) {
    Object.entries(err.body.errors).forEach(([k, v]) => { if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v })
  }
  return out
}

// --- Register a new owner, with one or more pets ---
export function RegisterPanel({ onClose, onDone }) {
  const [owner, setOwner] = useState({ name: '', mobile: '', email: '', additionalOwner: '', messenger: '', address: '', remindersOptIn: true })
  const [pets, setPets] = useState([blankPet()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [dupes, setDupes] = useState(null)

  async function save(confirmDuplicate = false) {
    setBusy(true)
    setError(null)
    try {
      const body = { ...owner, pets: pets.filter((p) => p.name.trim()), confirmDuplicate }
      const { owner: saved } = await api('owners', { method: 'POST', body })
      onDone(saved)
    } catch (err) {
      if (err.body?.code === 'possible_duplicate') setDupes(err.body.matches)
      else setError(err)
    } finally {
      setBusy(false)
    }
  }
  const errors = fieldErrors(error)
  const petErrors = (i) => fieldErrors(error, `pets.${i}.`)

  return (
    <Panel
      title={<>Register <em>owner</em></>}
      intro="Owner first, then their pets. You can add more pets later from the owner's page."
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Register owner'}</button>
        </>
      )}
    >
      <BreedList />
      {dupes && (
        <div className="alert" role="alert">
          <TriangleAlert aria-hidden />
          <div>
            <strong>This mobile number is already on file.</strong> Open the owner below to add the pet there, or register anyway if it's a different person.
            <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
              {dupes.map((d) => <li key={d.id}><Link to={`/clients/${d.id}`} onClick={onClose}>{d.name}</Link> · {d.customerNo}</li>)}
            </ul>
            <button type="button" className="btn btn-quiet" onClick={() => save(true)} disabled={busy}>Register anyway</button>
          </div>
        </div>
      )}
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <section className="form-section">
        <h3 className="label">Owner</h3>
        <OwnerFields value={owner} set={(p) => setOwner((o) => ({ ...o, ...p }))} errors={errors} />
      </section>
      {pets.map((pet, i) => (
        <section className="form-section" key={i}>
          <div className="form-section-head">
            <h3 className="label">Pet {pets.length > 1 ? i + 1 : ''}</h3>
            {pets.length > 1 && (
              <button type="button" className="icon-btn" onClick={() => setPets((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove pet ${i + 1}`} title="Remove this pet">
                <Trash2 />
              </button>
            )}
          </div>
          <PetFields idx={i} value={pet} errors={petErrors(i)} set={(p) => setPets((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)))} />
        </section>
      ))}
      {pets.length < 5 && (
        <button type="button" className="btn btn-quiet" onClick={() => setPets((ps) => [...ps, blankPet()])}>
          <Plus aria-hidden /> Add another pet
        </button>
      )}
    </Panel>
  )
}

// --- Edit owner details ---
export function EditOwnerPanel({ owner, onClose, onDone }) {
  const [value, setValue] = useState({
    name: owner.name || '', mobile: owner.mobileLocal || owner.mobileRaw || '', email: owner.email || '',
    additionalOwner: owner.additionalOwner || '', messenger: owner.messenger || '', address: owner.address || '',
    remindersOptIn: owner.remindersOptIn,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`owners/${owner.id}`, { method: 'PATCH', body: value })
      onDone(res.owner)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const errors = fieldErrors(error)
  return (
    <Panel
      title={<>Edit <em>owner</em></>}
      intro={owner.customerNo}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      )}
    >
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <section className="form-section">
        <OwnerFields value={value} set={(p) => setValue((v) => ({ ...v, ...p }))} errors={errors} />
      </section>
    </Panel>
  )
}

// --- Add a pet to an owner, or edit one ---
export function PetPanel({ ownerId, pet, onClose, onDone }) {
  const [value, setValue] = useState({
    name: pet?.name || '', species: pet?.species || 'dog', sex: pet?.sex || 'unknown', breed: pet?.breed || '',
    birthdate: pet?.birthdate || '', colorMarkings: pet?.colorMarkings || '', microchip: pet?.microchip || '',
    allergies: pet?.allergies || '', notes: pet?.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = pet
        ? await api(`pets/${pet.id}`, { method: 'PATCH', body: value })
        : await api('pets', { method: 'POST', body: { ...value, ownerId } })
      onDone(res.pet)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const errors = fieldErrors(error)
  return (
    <Panel
      title={pet ? <>Edit <em>{pet.name}</em></> : <>Add a <em>pet</em></>}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : pet ? 'Save changes' : 'Add pet'}</button>
        </>
      )}
    >
      <BreedList />
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <section className="form-section">
        <PetFields value={value} set={(p) => setValue((v) => ({ ...v, ...p }))} errors={errors} full />
      </section>
    </Panel>
  )
}
