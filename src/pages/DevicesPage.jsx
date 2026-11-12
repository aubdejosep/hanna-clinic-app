// Account ▸ Device Management: where you're logged in. Rename a device, log one out, or log out all
// the others (e.g. a lost phone). Only your own devices are shown.
import { useState } from 'react'
import { Clock, Globe, LogIn, LogOut, Monitor, Pencil, RefreshCw, Smartphone, Tablet } from 'lucide-react'
import { ErrorNote, Field, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'

// "Chrome 157 on Windows", "Mobile Safari on iPhone"…, from the browser's own description.
export function describe(ua = '') {
  const browser = /Edg\/(\d+)/.test(ua) ? ['Edge', ua.match(/Edg\/(\d+)/)[1]]
    : /SamsungBrowser\/(\d+)/.test(ua) ? ['Samsung Internet', ua.match(/SamsungBrowser\/(\d+)/)[1]]
      : /OPR\/(\d+)/.test(ua) ? ['Opera', ua.match(/OPR\/(\d+)/)[1]]
        : /Firefox\/(\d+)/.test(ua) ? ['Firefox', ua.match(/Firefox\/(\d+)/)[1]]
          : /CriOS\/(\d+)/.test(ua) ? ['Chrome', ua.match(/CriOS\/(\d+)/)[1]]
            : /Chrome\/(\d+)/.test(ua) ? ['Chrome', ua.match(/Chrome\/(\d+)/)[1]]
              : /Version\/(\d+).*Safari/.test(ua) ? ['Safari', ua.match(/Version\/(\d+)/)[1]]
                : ['Browser', '']
  const os = /Windows NT/.test(ua) ? 'Windows'
    : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
      : /Android ([\d.]+)/.test(ua) ? `Android ${ua.match(/Android ([\d.]+)/)[1].split('.')[0]}`
        : /Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Unknown system'
  const type = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'mobile' : 'desktop'
  return { browser: browser[0], version: browser[1], os, type }
}

function since(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`
  if (s < 86400 * 1.5) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago` }
  const d = Math.round(s / 86400)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
const TYPE = { desktop: [Monitor, 'Computer'], mobile: [Smartphone, 'Phone'], tablet: [Tablet, 'Tablet'] }

function Device({ s, onChanged }) {
  const toast = useToast()
  const [name, setName] = useState(null)
  const [busy, setBusy] = useState(false)
  const d = describe(s.userAgent || '')
  const [Icon, typeLabel] = TYPE[d.type]
  const title = s.name || `${d.browser} on ${d.os}`
  async function rename(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await api(`me/sessions/${s.id}`, { method: 'PATCH', body: { name } })
      toast(name ? `Renamed to ${name}` : 'Name cleared')
      setName(null)
      onChanged()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function logOut() {
    setBusy(true)
    try {
      const res = await api(`me/sessions/${s.id}`, { method: 'DELETE' })
      if (res.current) { window.location.assign('/'); return }
      toast(`${title} logged out`)
      onChanged()
    } catch (err) {
      toast(err.message)
      setBusy(false)
    }
  }
  return (
    <li className={`card device ${s.current ? 'is-current' : ''}`}>
      <div className="device-head">
        <span className="device-icon"><Icon aria-hidden /></span>
        <div className="device-title">
          <strong>{title}</strong>
          <span className="label">{typeLabel}{s.name ? ` · ${d.browser} on ${d.os}` : ''}</span>
        </div>
        {s.current && <span className="badge device-current">This Device</span>}
      </div>
      {name !== null ? (
        <form className="device-rename" onSubmit={rename}>
          <Field label="Device Name" hint="e.g. Front Desk PC, Doc’s Phone. Leave blank for the browser’s name.">{(a) => <input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />}</Field>
          <div className="inline-row">
            <button type="submit" className="btn" disabled={busy}>Save Name</button>
            <button type="button" className="btn btn-quiet" onClick={() => setName(null)} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : (
        <dl className="device-facts">
          <div><dt><Monitor aria-hidden /> System</dt><dd>{d.browser}{d.version ? ` ${d.version}` : ''}<span className="cell-sub">{d.os}</span></dd></div>
          <div><dt><Globe aria-hidden /> IP Address</dt><dd className="mono">{s.ip || 'Not recorded'}</dd></div>
          <div><dt><Clock aria-hidden /> Last Active</dt><dd>{s.current ? 'Now' : since(s.lastActiveAt)}</dd></div>
          <div><dt><LogIn aria-hidden /> Logged In</dt><dd>{since(s.loggedInAt)}<span className="cell-sub">{s.remember ? 'Remember me: 30 days' : 'Until the end of the day'}</span></dd></div>
        </dl>
      )}
      {name === null && (
        <div className="device-actions">
          <button type="button" className="text-btn" onClick={() => setName(s.name || '')}><Pencil size={14} aria-hidden /> Rename</button>
          <button type="button" className="text-btn device-out" onClick={logOut} disabled={busy}><LogOut size={14} aria-hidden /> {s.current ? 'Log Out Here' : 'Log Out'}</button>
        </div>
      )}
    </li>
  )
}

export default function DevicesPage() {
  const { data, error, reload } = useApi('me/sessions')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const others = (data?.sessions || []).filter((s) => !s.current).length
  async function logOutOthers() {
    if (!window.confirm(`Log out ${others} other device${others === 1 ? '' : 's'}? You stay logged in here.`)) return
    setBusy(true)
    try {
      const res = await api('me/sessions', { method: 'POST', body: { action: 'logout_others' } })
      toast(`${res.loggedOut} device${res.loggedOut === 1 ? '' : 's'} logged out`)
      reload()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHead crumbs={[{ label: 'Account' }, { label: 'Device Management' }]} title="Device Management" intro="Where you’re logged in. Log out a device you no longer use, or all others if a phone is lost.">
        <div className="head-actions">
          <button type="button" className="icon-btn" onClick={reload} aria-label="Refresh" title="Refresh"><RefreshCw /></button>
          <button type="button" className="btn btn-quiet" onClick={logOutOthers} disabled={busy || !others}><LogOut aria-hidden /> Log Out All Others</button>
        </div>
      </PageHead>
      <ErrorNote error={error} />
      {!data ? <PawLoader label="Loading your devices…" /> : (
        <ul className="device-grid">
          {data.sessions.map((s) => <Device key={s.id} s={s} onChanged={reload} />)}
        </ul>
      )}
    </>
  )
}
