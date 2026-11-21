// A message across the top of the app while this PC or phone can't reach the clinic app (the clinic's internet is
// down, or no signal): what still works and what to do. Shown when the browser says it's offline or a request to the
// app fails; while it shows, the app is checked every 10 seconds, and it goes away (with "Back online") by itself.
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'
import { useToast } from './ui.jsx'

async function reachable() {
  try { const r = await fetch(`/manifest.webmanifest?ping=${Date.now()}`, { cache: 'no-store' }); return r.ok || r.status < 500 } catch { return false }
}

export default function OfflineBanner() {
  const toast = useToast()
  const [down, setDown] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [checking, setChecking] = useState(false)
  const was = useRef(down)
  useEffect(() => {
    const off = () => setDown(true)
    const on = () => setDown(false)
    const maybeOn = () => { reachable().then((ok) => ok && setDown(false)) }
    window.addEventListener('offline', off)
    window.addEventListener('clinic:offline', off)
    window.addEventListener('clinic:online', on)
    window.addEventListener('online', maybeOn)
    return () => { window.removeEventListener('offline', off); window.removeEventListener('clinic:offline', off); window.removeEventListener('clinic:online', on); window.removeEventListener('online', maybeOn) }
  }, [])
  useEffect(() => {
    if (was.current && !down) toast('Back online. Anything that didn’t save, try it again.')
    was.current = down
    if (!down) return undefined
    const t = setInterval(() => { reachable().then((ok) => ok && setDown(false)) }, 10000)
    return () => clearInterval(t)
  }, [down]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!down) return null
  async function retry() {
    setChecking(true)
    const ok = await reachable()
    setChecking(false)
    if (ok) setDown(false)
    else toast('Still no internet. Try the pocket Wi-Fi or a phone hotspot.')
  }
  return (
    <div className="offline-bar" role="alert">
      <WifiOff aria-hidden />
      <div>
        <strong>No Internet Connection</strong>
        <span>Nothing can be saved right now. Connect this device to the <b>pocket Wi-Fi</b> or a <b>phone hotspot</b>. If that’s not possible, use the printed appointment list and paper receipts, and type them in once the internet is back.</span>
      </div>
      <button type="button" className="btn btn-sm" onClick={retry} disabled={checking}><RefreshCw aria-hidden /> {checking ? 'Checking…' : 'Try Again'}</button>
    </div>
  )
}
