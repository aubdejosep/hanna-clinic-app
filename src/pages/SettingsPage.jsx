// Account ▸ Settings: this person's theme and text size (saved to their login, so they follow them to
// any device), and their password.
import { useState } from 'react'
import { Check, ImageUp, KeyRound, Palette, RotateCcw, Type } from 'lucide-react'
import { PageHead, useToast } from '../components/ui.jsx'
import AccountPanel from '../components/AccountPanel.jsx'
import { api } from '../lib/api.js'
import { canManage, useStaff } from '../lib/staff.js'
import { setLogoVersion, useLogo } from '../lib/logo.js'
import LogoCropper from '../components/LogoCropper.jsx'
import { THEMES, TEXT_SIZES, applyDisplay } from '../lib/theme.js'

function Swatch({ theme }) {
  return (
    <span className={`theme-swatch swatch-${theme}`} aria-hidden>
      <span className="sw-side" />
      <span className="sw-main">
        <span className="sw-card"><i className="sw-title" /><i className="sw-line" /><i className="sw-line short" /><i className="sw-btn" /></span>
      </span>
    </span>
  )
}

// Owners and admins: the clinic logo for everyone (sidebar, top bar, Clinic Profile, login screen).
function ClinicLogo() {
  const logo = useLogo()
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const custom = logo !== '/brand/logo-192.png'
  async function upload(blob) {
    setBusy(true)
    try {
      const r = await fetch('/api/settings/logo', { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/png' }, credentials: 'same-origin' })
      const res = await r.json().catch(() => null)
      if (!r.ok) throw new Error(res?.error || 'The logo didn’t upload. Please try again.')
      setLogoVersion(res.logoVersion)
      setFile(null)
      toast('Logo updated for everyone')
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function reset() {
    try {
      await api('settings/logo', { method: 'DELETE' })
      setLogoVersion(null)
      toast('Back to the original logo')
    } catch (err) {
      toast(err.message)
    }
  }
  return (
    <section className="card">
      <div className="card-head"><div className="settings-head"><span className="settings-icon"><ImageUp aria-hidden /></span><div><h2>Clinic Logo</h2><p>Shown to everyone in the app: the menu, the top bar on phones and Clinic Profile. Owners and admins only.</p></div></div></div>
      <div className="card-pad logo-setting">
        <img src={logo} alt="Current clinic logo" width="96" height="96" />
        <div className="stack" style={{ gap: 8 }}>
          <label className="btn btn-quiet" style={{ justifySelf: 'start' }}>
            <ImageUp aria-hidden /> Upload New Logo
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setFile(f) }} />
          </label>
          <span className="field-hint">PNG, JPG, WebP or SVG. A PNG with a see-through background looks best. You’ll crop it to a square next.</span>
          {custom && <button type="button" className="text-btn" style={{ justifySelf: 'start' }} onClick={reset}><RotateCcw size={14} aria-hidden /> Use the Original Logo</button>}
        </div>
      </div>
      {file && <LogoCropper file={file} busy={busy} onClose={() => setFile(null)} onSave={upload} />}
    </section>
  )
}

export default function SettingsPage({ onStaff }) {
  const staff = useStaff()
  const toast = useToast()
  const [display, setDisplay] = useState({ theme: staff.theme || 'brand', textSize: staff.textSize || 'standard' })
  const [password, setPassword] = useState(false)
  async function save(patch, msg) {
    const prev = display
    const next = { ...display, ...patch }
    setDisplay(next)
    applyDisplay(next) // shows straight away
    try {
      await api('me/settings', { method: 'PATCH', body: patch })
      onStaff?.({ ...staff, ...next })
      toast(msg)
    } catch (err) {
      setDisplay(prev)
      applyDisplay(prev)
      toast(err.message)
    }
  }
  return (
    <>
      <PageHead crumbs={[{ label: 'Account' }, { label: 'Settings' }]} title="Account Settings" intro="How the app looks for you. Saved to your login, so it follows you to any device." />
      <div className="stack settings">
        <section className="card">
          <div className="card-head"><div className="settings-head"><span className="settings-icon"><Palette aria-hidden /></span><div><h2>Theme</h2><p>The app’s colours.</p></div></div></div>
          <div className="card-pad theme-grid" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.key} type="button" role="radio" aria-checked={display.theme === t.key} className="theme-option" onClick={() => display.theme !== t.key && save({ theme: t.key }, `Theme: ${t.label}`)}>
                <Swatch theme={t.key} />
                <span className="theme-name"><strong>{t.label}</strong>{display.theme === t.key && <Check aria-label="Chosen" />}</span>
                <span className="cell-sub">{t.text}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div className="settings-head"><span className="settings-icon"><Type aria-hidden /></span><div><h2>Text Size</h2><p>Makes everything bigger, on top of the theme.</p></div></div></div>
          <div className="card-pad">
            <div className="tabs" role="radiogroup" aria-label="Text size">
              {TEXT_SIZES.map((s) => (
                <button key={s.key} type="button" role="radio" className="tab" aria-checked={display.textSize === s.key} aria-pressed={display.textSize === s.key}
                  onClick={() => display.textSize !== s.key && save({ textSize: s.key }, `Text size: ${s.label}`)}>{s.label}</button>
              ))}
            </div>
            <p className="field-hint" style={{ marginBottom: 0 }}>Example: <span style={{ fontSize: 'var(--fs-body)' }}>Peach · Cat · 4 yrs</span> <span className="cell-sub" style={{ display: 'inline' }}>· Booked online</span></p>
          </div>
        </section>
        {canManage(staff) && <ClinicLogo />}
        <section className="card">
          <div className="card-head">
            <div className="settings-head"><span className="settings-icon"><KeyRound aria-hidden /></span><div><h2>Password</h2><p>Logged in as {staff.email}.</p></div></div>
            <button type="button" className="btn btn-quiet" onClick={() => setPassword(true)}>Change Password</button>
          </div>
        </section>
      </div>
      {password && <AccountPanel staff={staff} onClose={() => setPassword(false)} />}
    </>
  )
}
