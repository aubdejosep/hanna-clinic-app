// POST /api/auth/logout -> ends this device's session
import { json, audit } from '../../../lib/http.js'
import { endSession, clearCookie } from '../../../lib/auth.js'

export async function onRequestPost({ request, env, data }) {
  await endSession(request, env)
  await audit(env, data.staff.email, 'logout', 'staff', data.staff.id)
  const res = json({ ok: true })
  res.headers.append('Set-Cookie', clearCookie())
  return res
}
