// The clinic logo everywhere in the app: the one uploaded in Settings (served at /api/settings/logo,
// versioned so browsers refresh after a change), else the built-in /brand/logo-192.png.
// The login screen can't load the uploaded one (it's behind the login), so each browser keeps a small
// copy after logging in and shows that on the login screen.
import { useSyncExternalStore } from 'react'

const DEFAULT = '/brand/logo-192.png'
const CACHE = 'hpw.logo'
let src = (() => { try { return localStorage.getItem(CACHE) || DEFAULT } catch { return DEFAULT } })()
const subs = new Set()
const emit = () => subs.forEach((f) => f())

export function setLogoVersion(version) {
  const next = version ? `/api/settings/logo?v=${version}` : DEFAULT
  if (next !== src) { src = next; emit() }
  try {
    if (!version) { localStorage.removeItem(CACHE); return }
    // a small copy for the login screen on this browser
    fetch(next, { credentials: 'same-origin' }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!b || b.size > 400 * 1024) return
      const fr = new FileReader()
      fr.onload = () => { try { localStorage.setItem(CACHE, fr.result) } catch { /* full or private */ } }
      fr.readAsDataURL(b)
    }).catch(() => {})
  } catch { /* private window */ }
}
export const useLogo = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => src)
