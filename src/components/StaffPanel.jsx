// Add or edit a staff member: the same sections, in the same order, as the old Edit Staff panel.
import { useState } from 'react'
import { Camera, Copy, Trash2, Upload } from 'lucide-react'
import { api, ApiError } from '../lib/api.js'
import { resizeImage } from '../lib/images.js'
import { DAY_KEYS, DAY_NAMES } from '../lib/schedule.js'
import { ErrorNote, Field, Panel } from './ui.jsx'
import SignaturePad from './SignaturePad.jsx'

const ROLE_OPTIONS = [['owner', 'Owner'], ['vet', 'Veterinarian'], ['front_desk', 'Front desk'], ['groomer', 'Groomer']]

function initialForm(s) {
  return {
    firstName: s?.firstName || '', lastName: s?.lastName || '', email: s?.email || '', phone: s?.phoneLocal || '',
    role: s?.role || 'front_desk', title: s?.title || '', password: '',
    licenseNo: s?.licenseNo || '', licenseExpiry: s?.licenseExpiry || '', ptrNo: s?.ptrNo || '', s2No: s?.s2No || '',
    street: s?.street || '', city: s?.city || '', province: s?.province || '', postalCode: s?.postalCode || '', country: s?.country || 'Philippines',
    maxLeaveDays: s?.maxLeaveDays ?? '', schedule: s?.schedule || {}, active: s ? s.active : true,
  }
}

export default function StaffPanel({ staff, me, onClose, onDone }) {
  const editing = !!staff
  const [form, setForm] = useState(() => initialForm(staff))
  const [photo, setPhoto] = useState(undefined)        // undefined = unchanged, null = remove, string = new
  const [signature, setSignature] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  const v = staff?.imagesUpdatedAt ? `?v=${encodeURIComponent(staff.imagesUpdatedAt)}` : ''
  const photoSrc = photo === undefined ? (staff?.hasPhoto ? `/api/staff/${staff.id}/photo${v}` : null) : photo
  const isMe = editing && staff.id === me.id

  async function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try { setPhoto(await resizeImage(file)) } catch (err) { setError(err) }
  }

  function setDay(day, patch) {
    setForm((f) => {
      const schedule = { ...f.schedule }
      if (patch === null) delete schedule[day]
      else schedule[day] = { start: '09:00', end: '18:00', ...schedule[day], ...patch }
      return { ...f, schedule }
    })
  }
  function copyFirstDay() {
    const first = DAY_KEYS.find((d) => form.schedule[d])
    if (!first) return
    set({ schedule: Object.fromEntries(DAY_KEYS.filter((d) => form.schedule[d]).map((d) => [d, { ...form.schedule[first] }])) })
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const body = { ...form }
      if (editing && !body.password) delete body.password
      const res = editing
        ? await api(`staff/${staff.id}`, { method: 'PATCH', body })
        : await api('staff', { method: 'POST', body })
      const id = res.staff.id
      if (photo !== undefined) await api(`staff/${id}/photo`, photo ? { method: 'PUT', body: { dataUrl: photo } } : { method: 'DELETE' })
      if (signature !== undefined) await api(`staff/${id}/signature`, signature ? { method: 'PUT', body: { dataUrl: signature } } : { method: 'DELETE' })
      onDone(res.staff, !editing)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={editing ? `Edit ${staff.name}` : 'Add staff member'}
      intro={editing ? 'Update the staff member’s details below.' : 'They log in with the email and password you set here.'}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Update staff' : 'Add staff'}</button>
        </>
      )}
    >
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      {Object.keys(errors).length > 0 && <ErrorNote error={new Error('Some details need fixing. They’re marked below.')} />}

      <section className="form-section">
        <h3 className="label">Profile picture <small>(optional)</small></h3>
        <div className="photo-row">
          <span className="avatar avatar-lg photo">{photoSrc ? <img src={photoSrc} alt="" /> : (form.firstName[0] || '?').toUpperCase()}</span>
          <div className="photo-btns">
            <label className="btn btn-quiet"><Camera aria-hidden /> Take a photo<input type="file" accept="image/*" capture="user" onChange={pickPhoto} hidden /></label>
            <label className="btn btn-quiet"><Upload aria-hidden /> Upload a file<input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickPhoto} hidden /></label>
            {photoSrc && <button type="button" className="icon-btn" onClick={() => setPhoto(null)} aria-label="Remove photo" title="Remove photo"><Trash2 /></button>}
          </div>
        </div>
      </section>

      <section className="form-section">
        <h3 className="label">Staff role</h3>
        <div className="form-row">
          <Field label="Access role" hint="Owners can manage staff and remove records." error={errors.role}>
            {(a) => (
              <select {...a} value={form.role} onChange={(e) => set({ role: e.target.value })} disabled={isMe && staff.role === 'owner'}>
                {ROLE_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Job title" optional hint="Shown next to their name, e.g. Resident Veterinarian.">
            {(a) => <input {...a} value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={60} />}
          </Field>
        </div>
        <div className="form-row">
          <Field label="License number" optional error={errors.licenseNo}>
            {(a) => <input {...a} value={form.licenseNo} onChange={(e) => set({ licenseNo: e.target.value })} placeholder="e.g. VET-2024-001234" maxLength={30} />}
          </Field>
          <Field label="License expiry date" optional error={errors.licenseExpiry}>
            {(a) => <input {...a} type="date" value={form.licenseExpiry} onChange={(e) => set({ licenseExpiry: e.target.value })} />}
          </Field>
        </div>
        <div className="form-row">
          <Field label="PTR number" optional>
            {(a) => <input {...a} value={form.ptrNo} onChange={(e) => set({ ptrNo: e.target.value })} placeholder="e.g. PTR-2024-001234" maxLength={30} />}
          </Field>
          <Field label="S2 number" optional>
            {(a) => <input {...a} value={form.s2No} onChange={(e) => set({ s2No: e.target.value })} placeholder="e.g. 0012345" maxLength={30} />}
          </Field>
        </div>
        <div className="field">
          <span>Signature <small>(optional, for printouts)</small></span>
          <SignaturePad existingUrl={signature === undefined && staff?.hasSignature ? `/api/staff/${staff.id}/signature${v}` : null} onChange={setSignature} />
        </div>
      </section>

      <section className="form-section">
        <h3 className="label">Account information</h3>
        <div className="form-row">
          <Field label="First name" error={errors.firstName}>
            {(a) => <input {...a} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} maxLength={50} />}
          </Field>
          <Field label="Last name" optional>
            {(a) => <input {...a} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} maxLength={50} />}
          </Field>
        </div>
        <div className="form-row">
          <Field label="Mobile" optional error={errors.phone}>
            {(a) => <input {...a} value={form.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" placeholder="0917 123 4567" />}
          </Field>
          <Field label="Email" hint="They log in with this." error={errors.email}>
            {(a) => <input {...a} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" />}
          </Field>
        </div>
        <Field
          label={editing ? 'Set a new password' : 'Password'}
          optional={editing}
          hint={editing ? 'Leave blank to keep their password. Setting one logs them out everywhere.' : 'At least 10 characters. Tell them privately; they can change it under My account.'}
          error={errors.password}
        >
          {(a) => <input {...a} type="text" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" spellCheck={false} />}
        </Field>
      </section>

      <section className="form-section">
        <h3 className="label">Address <small>(optional)</small></h3>
        <Field label="Street address">
          {(a) => <input {...a} value={form.street} onChange={(e) => set({ street: e.target.value })} maxLength={255} />}
        </Field>
        <div className="form-row">
          <Field label="City">{(a) => <input {...a} value={form.city} onChange={(e) => set({ city: e.target.value })} maxLength={100} />}</Field>
          <Field label="Province">{(a) => <input {...a} value={form.province} onChange={(e) => set({ province: e.target.value })} maxLength={100} />}</Field>
        </div>
        <div className="form-row">
          <Field label="Postal code">{(a) => <input {...a} value={form.postalCode} onChange={(e) => set({ postalCode: e.target.value })} maxLength={20} />}</Field>
          <Field label="Country">{(a) => <input {...a} value={form.country} onChange={(e) => set({ country: e.target.value })} maxLength={60} />}</Field>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-head">
          <h3 className="label">Shift schedule</h3>
          <button type="button" className="btn btn-quiet" onClick={copyFirstDay} title="Give every working day the first day’s hours"><Copy aria-hidden /> Same hours every day</button>
        </div>
        {errors.schedule && <span className="field-error">{errors.schedule}</span>}
        <div className="schedule">
          {DAY_KEYS.map((day) => {
            const d = form.schedule[day]
            return (
              <div className="schedule-row" key={day}>
                <label className="check">
                  <input type="checkbox" checked={!!d} onChange={(e) => setDay(day, e.target.checked ? {} : null)} />
                  <span>{DAY_NAMES[day]}</span>
                </label>
                {d ? (
                  <>
                    <input type="time" value={d.start} onChange={(e) => setDay(day, { start: e.target.value })} aria-label={`${DAY_NAMES[day]} start`} />
                    <span className="field-hint">to</span>
                    <input type="time" value={d.end} onChange={(e) => setDay(day, { end: e.target.value })} aria-label={`${DAY_NAMES[day]} end`} />
                  </>
                ) : <span className="field-hint">Day off</span>}
              </div>
            )
          })}
        </div>
        <Field label="Max yearly leave days" optional error={errors.maxLeaveDays}>
          {(a) => <input {...a} type="number" min="0" max="365" value={form.maxLeaveDays} onChange={(e) => set({ maxLeaveDays: e.target.value })} style={{ maxWidth: 160 }} />}
        </Field>
      </section>

      {editing && (
        <section className="form-section">
          <h3 className="label">System access</h3>
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} disabled={isMe} />
            <span>
              <strong>Can log in</strong><br />
              {isMe ? "You can't switch off your own account." : 'Untick when someone leaves. They’re logged out at once, and their name stays on past records.'}
            </span>
          </label>
        </section>
      )}
    </Panel>
  )
}
