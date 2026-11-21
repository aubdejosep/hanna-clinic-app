// "A new version of the app is ready": shown when the version live on the server (/version.json, written by each build,
// see vite.config.js) differs from the one this tab is running. Checked every 5 minutes and whenever the tab comes back
// into view. It stays until Reload Now (nothing reloads by itself, so typing in progress isn't lost).
import { useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'

/* global __APP_VERSION__ */
const MINE = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null

async function liveVersion() {
  try { const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' }); return r.ok ? (await r.json()).version : null } catch { return null }
}

export default function UpdateNotice() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!MINE) return undefined
    const check = async () => { const v = await liveVersion(); if (v && v !== MINE) setReady(true) }
    const t = setInterval(check, 5 * 60 * 1000)
    const vis = () => { if (!document.hidden) check() }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('focus', vis)
    check()
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis) }
  }, [])
  if (!ready) return null
  return (
    <div className="update-toast" role="alert">
      <Sparkles aria-hidden />
      <div>
        <strong>A New Version Is Ready</strong>
        <span>Save what you’re typing, then reload to keep using the app.</span>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}><RefreshCw aria-hidden /> Reload Now</button>
    </div>
  )
}
