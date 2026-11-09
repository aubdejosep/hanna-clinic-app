import { useState } from 'react'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { api } from '../lib/api.js'
import { ErrorNote } from '../components/ui.jsx'

export default function LoginPage({ onLoggedIn }) {
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem('hpw:last-email') || '' } catch { return '' }
  })
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('auth/login', { method: 'POST', body: { email, password, remember } })
      try { localStorage.setItem('hpw:last-email', email.trim().toLowerCase()) } catch { /* private window */ }
      onLoggedIn()
    } catch (err) {
      setError(err)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit} noValidate>
        <img src="/brand/logo-192.png" alt="Hanna Pet Wellness Center" width="96" height="96" />
        <h1>Welcome Back</h1>
        <p className="muted">Log in to the clinic app to continue.</p>

        <ErrorNote error={error} />

        <label className="field">
          <span>Email</span>
          <span className="input-icon">
            <Mail aria-hidden />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus={!email} />
          </span>
        </label>
        <label className="field">
          <span>Password</span>
          <span className="input-icon">
            <Lock aria-hidden />
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" required autoFocus={!!email} />
            <button type="button" className="reveal" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide Password' : 'Show Password'} title={show ? 'Hide Password' : 'Show Password'}>
              {show ? <EyeOff /> : <Eye />}
            </button>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember me <span className="muted">(stay logged in on this device for 30 days)</span></span>
        </label>
        <button type="submit" className="btn login-btn" disabled={busy || !email || !password}>{busy ? 'Logging in…' : 'Log In'}</button>
        <p className="muted login-help">Forgot your password? Ask a clinic owner to set a new one.</p>
      </form>
    </main>
  )
}
