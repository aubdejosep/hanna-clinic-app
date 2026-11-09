// /kiosk: clients register themselves and their pets from the QR code at the clinic.
// Open without logging in. Same steps as the old kiosk: owner (account, contact, address,
// notifications), then each pet (basic info, details, age, health).
import { useEffect, useRef, useState } from 'react'
import { Cake, Check, ChevronLeft, ChevronRight, HeartPulse, Home, PawPrint, Phone, Plus, User, Bell } from 'lucide-react'
import { api, ApiError } from '../lib/api.js'
import { BREED_NAMES } from '../lib/breeds.js'
import { ErrorNote, Field } from '../components/ui.jsx'

const OWNER_STEPS = [
  { key: 'account', label: 'Account information', icon: User },
  { key: 'contact', label: 'Contact information', icon: Phone },
  { key: 'address', label: 'Address information', icon: Home },
  { key: 'notify', label: 'Notifications', icon: Bell },
]
const PET_STEPS = [
  { key: 'basic', label: 'Basic info', icon: PawPrint },
  { key: 'details', label: 'Pet details', icon: Check },
  { key: 'age', label: 'Age', icon: Cake },
  { key: 'health', label: 'Health info', icon: HeartPulse },
]
const blankOwner = () => ({ firstName: '', lastName: '', mobile: '', messenger: '', email: '', street: '', city: '', province: '', postalCode: '', country: 'Philippines', reminders: false })
const blankPet = () => ({ name: '', microchip: '', species: 'dog', breed: '', sex: 'unknown', colorMarkings: '', birthdate: '', allergies: '', notes: '' })
const mobileOk = (m) => /^(?:\+?63|0)?9\d{9}$/.test(String(m).replace(/[^\d+]/g, ''))
const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)

function Stepper({ steps, at }) {
  return (
    <ol className="kiosk-steps">
      {steps.map((s, i) => (
        <li key={s.key} className={i < at ? 'done' : i === at ? 'current' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="kiosk-dot">{i < at ? <Check aria-hidden /> : <s.icon aria-hidden />}</span>
          <span className="kiosk-step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}

function Turnstile({ siteKey, onToken }) {
  const box = useRef(null)
  useEffect(() => {
    let id
    const draw = () => { if (box.current && window.turnstile && id === undefined) id = window.turnstile.render(box.current, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken(null) }) }
    if (window.turnstile) draw()
    else {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.onload = draw
      document.head.appendChild(s)
    }
    return () => { if (id !== undefined && window.turnstile) window.turnstile.remove(id) }
  }, [siteKey, onToken])
  return <div ref={box} className="kiosk-turnstile" />
}

export default function KioskPage() {
  const [config, setConfig] = useState(null)
  const [stage, setStage] = useState('owner') // owner | pet | done
  const [step, setStep] = useState(0)
  const [owner, setOwner] = useState(blankOwner)
  const [pets, setPets] = useState([blankPet()])
  const [petIndex, setPetIndex] = useState(0)
  const [agreed, setAgreed] = useState(false)
  const [token, setToken] = useState(null)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => { api('kiosk/config').then(setConfig).catch((err) => setError(err)) }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [stage, step, petIndex])
  // On a shared tablet, the thank-you screen clears itself after a minute.
  useEffect(() => {
    if (stage !== 'done') return
    const t = setTimeout(restart, 60000)
    return () => clearTimeout(t)
  }, [stage])

  const pet = pets[petIndex]
  const setO = (patch) => setOwner((o) => ({ ...o, ...patch }))
  const setP = (patch) => setPets((ps) => ps.map((p, i) => (i === petIndex ? { ...p, ...patch } : p)))

  function restart() {
    setStage('owner'); setStep(0); setOwner(blankOwner()); setPets([blankPet()]); setPetIndex(0)
    setAgreed(false); setToken(null); setErrors({}); setError(null); setResult(null)
  }

  // Checks the current step before moving on. -> true when it's fine
  function check() {
    const e = {}
    if (stage === 'owner') {
      if (step === 0) {
        if (!owner.firstName.trim()) e['owner.firstName'] = 'Enter your first name.'
        if (!owner.lastName.trim()) e['owner.lastName'] = 'Enter your last name.'
      }
      if (step === 1) {
        if (!mobileOk(owner.mobile)) e['owner.mobile'] = 'Enter your mobile number, like 0917 123 4567.'
        if (!emailOk(owner.email.trim())) e['owner.email'] = 'Check your email address, e.g. name@gmail.com.'
      }
      if (step === 3) {
        if (!owner.reminders) e['owner.reminders'] = 'Tick the box to get appointment reminders.'
        if (config?.agreement && !agreed) e.agreed = 'Please read and accept the agreement.'
      }
    } else if (stage === 'pet' && step === 0 && !pet.name.trim()) {
      e[`pets.${petIndex}.name`] = "Enter your pet's name."
    } else if (stage === 'pet' && step === 2 && pet.birthdate && pet.birthdate > new Date().toISOString().slice(0, 10)) {
      e[`pets.${petIndex}.birthdate`] = "Enter a birthdate that isn't in the future."
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  function next() {
    if (!check()) return
    if (stage === 'owner' && step < 3) setStep(step + 1)
    else if (stage === 'owner') { setStage('pet'); setStep(0) }
    else if (step < 3) setStep(step + 1)
  }
  function back() {
    setErrors({})
    if (step > 0) setStep(step - 1)
    else if (stage === 'pet' && petIndex > 0) { setPetIndex(petIndex - 1); setStep(3) }
    else if (stage === 'pet') { setStage('owner'); setStep(3) }
  }
  function addPet() {
    if (!check()) return
    setPets((ps) => [...ps, blankPet()])
    setPetIndex(pets.length)
    setStep(0)
  }

  async function register() {
    if (!check()) return
    setBusy(true)
    setError(null)
    try {
      const res = await api('kiosk/register', { method: 'POST', body: { owner, pets, agreed, turnstileToken: token } })
      setResult(res)
      setStage('done')
    } catch (err) {
      setError(err)
      if (err instanceof ApiError && err.body.errors) {
        setErrors(err.body.errors)
        const keys = Object.keys(err.body.errors)
        if (keys.some((k) => k.startsWith('owner.') || k === 'agreed')) { setStage('owner'); setStep(keys.some((k) => /first|last/i.test(k)) ? 0 : keys.some((k) => /mobile|email/.test(k)) ? 1 : 3) }
      }
      setToken(null)
    } finally {
      setBusy(false)
    }
  }

  const f = (key) => errors[key]
  const header = (title, of) => (
    <header className="kiosk-head">
      <div className="kiosk-head-row">
        <img src="/brand/logo-192.png" alt="" width="48" height="48" />
        <h1>{title}</h1>
        <span className="kiosk-of"><strong>{of}/2</strong><small>STEPS</small></span>
      </div>
      <div className="kiosk-bar"><span style={{ width: of === 1 ? `${((step + 1) / 4) * 50}%` : `${50 + ((step + 1) / 4) * 50}%` }} /></div>
    </header>
  )

  if (!config) return <main className="kiosk"><div className="kiosk-card card-pad">{error ? <ErrorNote error={error} /> : 'Loading…'}</div></main>
  if (!config.enabled) {
    return (
      <main className="kiosk">
        <div className="card kiosk-card kiosk-done">
          <img src="/brand/logo-192.png" alt="" width="96" height="96" />
          <h1>Welcome to {config.clinicName}</h1>
          <p>Sign-up here is closed right now. Please ask the front desk and we’ll register you.</p>
        </div>
      </main>
    )
  }

  if (stage === 'done') {
    return (
      <main className="kiosk">
        <div className="card kiosk-card kiosk-done">
          <span className="kiosk-tick"><Check aria-hidden /></span>
          <h1>Thank you, {result.firstName}!</h1>
          <p>You’re registered{result.pets.length ? <> with <strong>{result.pets.join(', ')}</strong></> : null}. Please let the front desk know you’re here.</p>
          <button type="button" className="btn" onClick={restart}>Start a new registration</button>
        </div>
      </main>
    )
  }

  const onLastPetStep = stage === 'pet' && step === 3
  return (
    <main className="kiosk">
      {stage === 'owner' ? header('Pet owner registration', 1) : header(pets.length > 1 ? `Pet registration (${petIndex + 1} of ${pets.length})` : 'Pet registration', 2)}

      <div className="card kiosk-card">
        <div className="kiosk-nav">
          <button type="button" className="icon-btn kiosk-arrow" onClick={back} disabled={stage === 'owner' && step === 0} aria-label="Back" title="Back"><ChevronLeft /></button>
          <Stepper steps={stage === 'owner' ? OWNER_STEPS : PET_STEPS} at={step} />
          {!(stage === 'owner' && step === 3) && !onLastPetStep
            ? <button type="button" className="icon-btn kiosk-arrow kiosk-next" onClick={next} aria-label="Next" title="Next"><ChevronRight /></button>
            : <span className="kiosk-arrow" />}
        </div>

        <div className="kiosk-body">
          <ErrorNote error={error && !Object.keys(errors).length ? error : null} />

          {stage === 'owner' && step === 0 && (
            <section className="form-section"><h2>Account information</h2>
              <div className="form-row">
                <Field label="First name" error={f('owner.firstName')}>{(a) => <input {...a} value={owner.firstName} onChange={(e) => setO({ firstName: e.target.value })} maxLength={50} autoComplete="given-name" autoFocus />}</Field>
                <Field label="Last name" error={f('owner.lastName')}>{(a) => <input {...a} value={owner.lastName} onChange={(e) => setO({ lastName: e.target.value })} maxLength={50} autoComplete="family-name" />}</Field>
              </div>
            </section>
          )}
          {stage === 'owner' && step === 1 && (
            <section className="form-section"><h2>Contact information</h2>
              <Field label="Mobile number" hint="For appointment reminders by text." error={f('owner.mobile')}>{(a) => <input {...a} value={owner.mobile} onChange={(e) => setO({ mobile: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" />}</Field>
              <Field label="Messenger name or link" optional>{(a) => <input {...a} value={owner.messenger} onChange={(e) => setO({ messenger: e.target.value })} maxLength={200} />}</Field>
              <Field label="Email" optional error={f('owner.email')}>{(a) => <input {...a} type="email" value={owner.email} onChange={(e) => setO({ email: e.target.value })} autoComplete="email" />}</Field>
            </section>
          )}
          {stage === 'owner' && step === 2 && (
            <section className="form-section"><h2>Address information</h2>
              <Field label="Street address" optional>{(a) => <input {...a} value={owner.street} onChange={(e) => setO({ street: e.target.value })} maxLength={100} autoComplete="street-address" />}</Field>
              <div className="form-row">
                <Field label="City" optional>{(a) => <input {...a} value={owner.city} onChange={(e) => setO({ city: e.target.value })} maxLength={50} autoComplete="address-level2" />}</Field>
                <Field label="Province" optional>{(a) => <input {...a} value={owner.province} onChange={(e) => setO({ province: e.target.value })} maxLength={30} autoComplete="address-level1" />}</Field>
              </div>
              <div className="form-row">
                <Field label="Postal code" optional>{(a) => <input {...a} value={owner.postalCode} onChange={(e) => setO({ postalCode: e.target.value })} maxLength={10} inputMode="numeric" autoComplete="postal-code" />}</Field>
                <Field label="Country">{(a) => <input {...a} value={owner.country} onChange={(e) => setO({ country: e.target.value })} maxLength={40} autoComplete="country-name" />}</Field>
              </div>
            </section>
          )}
          {stage === 'owner' && step === 3 && (
            <section className="form-section"><h2>Stay updated</h2>
              <label className="check">
                <input type="checkbox" checked={owner.reminders} onChange={(e) => setO({ reminders: e.target.checked })} />
                <span>I’d like to receive appointment reminders from {config.clinicName}.</span>
              </label>
              {f('owner.reminders') && <span className="field-error">{f('owner.reminders')}</span>}
              {config.agreement && (
                <>
                  <div className="kiosk-agreement">{config.agreement}</div>
                  <label className="check">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    <span>I have read and agree to the above.</span>
                  </label>
                  {f('agreed') && <span className="field-error">{f('agreed')}</span>}
                </>
              )}
            </section>
          )}

          {stage === 'pet' && step === 0 && (
            <section className="form-section"><h2>Basic information</h2>
              <div className="form-row">
                <Field label="Pet name" error={f(`pets.${petIndex}.name`)}>{(a) => <input {...a} value={pet.name} onChange={(e) => setP({ name: e.target.value })} maxLength={25} autoFocus />}</Field>
                <Field label="Microchip (iChip) number" optional>{(a) => <input {...a} value={pet.microchip} onChange={(e) => setP({ microchip: e.target.value })} maxLength={30} inputMode="numeric" />}</Field>
              </div>
            </section>
          )}
          {stage === 'pet' && step === 1 && (
            <section className="form-section"><h2>Pet details</h2>
              <datalist id="kiosk-breeds">{BREED_NAMES.map((b) => <option key={b} value={b} />)}</datalist>
              <div className="field"><span>Species</span>
                <div className="seg" role="radiogroup">{[['dog', 'Dog'], ['cat', 'Cat'], ['other', 'Other']].map(([v, l]) => <label key={v}><input type="radio" name="species" checked={pet.species === v} onChange={() => setP({ species: v })} /><span>{l}</span></label>)}</div>
              </div>
              <div className="field"><span>Sex</span>
                <div className="seg" role="radiogroup">{[['male', 'Male'], ['female', 'Female'], ['unknown', 'Not sure']].map(([v, l]) => <label key={v}><input type="radio" name="sex" checked={pet.sex === v} onChange={() => setP({ sex: v })} /><span>{l}</span></label>)}</div>
              </div>
              <div className="form-row">
                <Field label="Breed" optional hint="Pick from the list or type it.">{(a) => <input {...a} value={pet.breed} onChange={(e) => setP({ breed: e.target.value })} list="kiosk-breeds" maxLength={60} autoComplete="off" />}</Field>
                <Field label="Colour and markings" optional>{(a) => <input {...a} value={pet.colorMarkings} onChange={(e) => setP({ colorMarkings: e.target.value })} maxLength={100} />}</Field>
              </div>
            </section>
          )}
          {stage === 'pet' && step === 2 && (
            <section className="form-section"><h2>Age</h2>
              <Field label="Birthdate" optional hint="A guess is fine. Leave blank if you don’t know." error={f(`pets.${petIndex}.birthdate`)}>{(a) => <input {...a} type="date" value={pet.birthdate} onChange={(e) => setP({ birthdate: e.target.value })} max={new Date().toISOString().slice(0, 10)} />}</Field>
            </section>
          )}
          {stage === 'pet' && step === 3 && (
            <section className="form-section"><h2>Health information</h2>
              <Field label="Allergies" optional hint="Food or medicine your pet reacts to.">{(a) => <textarea {...a} value={pet.allergies} onChange={(e) => setP({ allergies: e.target.value })} rows={2} maxLength={500} />}</Field>
              <Field label="Anything else we should know?" optional>{(a) => <textarea {...a} value={pet.notes} onChange={(e) => setP({ notes: e.target.value })} rows={3} maxLength={1000} />}</Field>
            </section>
          )}
        </div>
      </div>

      <div className="kiosk-actions">
        {stage === 'owner' && step === 3 && <button type="button" className="btn kiosk-cta" onClick={next}>Next: Register pet</button>}
        {onLastPetStep && (
          <>
            {pets.length < 5 && <button type="button" className="btn btn-quiet kiosk-cta" onClick={addPet}><Plus aria-hidden /> Add another pet</button>}
            <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />
            <button type="button" className="btn kiosk-cta" onClick={register} disabled={busy || !token}>{busy ? 'Registering…' : 'Register'}</button>
            {!token && <span className="field-hint">Tick “I’m human” above to register.</span>}
          </>
        )}
      </div>
    </main>
  )
}
