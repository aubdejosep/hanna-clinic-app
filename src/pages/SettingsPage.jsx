// Account ▸ Settings: this person's theme and text size (saved to their login, so they follow them to
// any device), and their password.
import { useState } from 'react'
import { Check, KeyRound, Palette, Type } from 'lucide-react'
import { PageHead, useToast } from '../components/ui.jsx'
import AccountPanel from '../components/AccountPanel.jsx'
import { api } from '../lib/api.js'
import { useStaff } from '../lib/staff.js'
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
