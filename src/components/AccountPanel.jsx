// "My account": who's logged in, and Change password.
import { useState } from 'react'
import { Eye, EyeOff, LogOut } from 'lucide-react'
import { api, ApiError } from '../lib/api.js'
import { ROLE_LABEL } from '../lib/staff.js'
import { ErrorNote, Field, Panel, useToast } from './ui.jsx'

function PasswordInput({ value, onChange, show, autoComplete, ...a }) {
  return <input {...a} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
}

export default function AccountPanel({ staff, onClose, onLogOut }) {
  const [form, setForm] = useState({ current: '', next: '', again: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const toast = useToast()
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  const mismatch = form.again && form.again !== form.next ? "The two new passwords don't match." : null
  const errors = error instanceof ApiError ? error.body.errors || {} : {}

  async function save() {
    if (form.next !== form.again) { setError(new Error("The two new passwords don't match. Type the new one again.")); return }
    setBusy(true)
    setError(null)
    try {
      const res = await api('auth/password', { method: 'POST', body: { current: form.current, next: form.next } })
      toast(res.otherDevicesLoggedOut
        ? `Password changed. ${res.otherDevicesLoggedOut} other device${res.otherDevicesLoggedOut > 1 ? 's were' : ' was'} logged out.`
        : 'Password changed')
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Change Password"
      intro={`${staff.name} · ${staff.title || ROLE_LABEL[staff.role] || staff.role}`}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          {onLogOut && (
            <button type="button" className="btn btn-quiet" onClick={onLogOut} disabled={busy} style={{ marginRight: 'auto' }}>
              <LogOut aria-hidden /> Log Out
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy} style={onLogOut ? undefined : { marginRight: 'auto' }}>Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={busy || !form.current || !form.next || !form.again}>
            {busy ? 'Saving…' : 'Change Password'}
          </button>
        </>
      )}
    >
      <section className="form-section">
        <div className="field">
          <span>Email</span>
          <span>{staff.email}</span>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-head">
          <h3 className="label">Change Password</h3>
          <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide Passwords' : 'Show Passwords'} title={show ? 'Hide Passwords' : 'Show Passwords'}>
            {show ? <EyeOff /> : <Eye />}
          </button>
        </div>
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        <Field label="Current Password" error={errors.current}>
          {(a) => <PasswordInput {...a} value={form.current} onChange={set('current')} show={show} autoComplete="current-password" />}
        </Field>
        <Field label="New Password" hint="At least 10 characters. A short sentence is easy to remember." error={errors.next}>
          {(a) => <PasswordInput {...a} value={form.next} onChange={set('next')} show={show} autoComplete="new-password" />}
        </Field>
        <Field label="New Password Again" error={mismatch}>
          {(a) => <PasswordInput {...a} value={form.again} onChange={set('again')} show={show} autoComplete="new-password" />}
        </Field>
        <p className="field-hint" style={{ margin: 0 }}>Changing it logs you out on every other computer and phone. This one stays logged in.</p>
      </section>
    </Panel>
  )
}
