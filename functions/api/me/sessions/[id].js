// PATCH  /api/me/sessions/:id {name} -> renames one of your devices
// DELETE /api/me/sessions/:id -> logs that device out (your own devices only; this one too)

import { json, fail, readJson, clean, audit } from '../../../../lib/http.js'
import { clearCookie } from '../../../../lib/auth.js'

async function mine(env, id, staffId) {
  return env.DB.prepare('SELECT id FROM sessions WHERE id = ? AND staff_id = ? AND revoked_at IS NULL').bind(id, staffId).first()
}

export async function onRequestPatch({ request, env, params, data }) {
  const id = Number(params.id)
  if (!(await mine(env, id, data.staff.id))) return fail(404, 'This device is no longer logged in.')
  const name = clean((await readJson(request))?.name, 40) || null
  await env.DB.prepare('UPDATE sessions SET device_name = ? WHERE id = ?').bind(name, id).run()
  return json({ ok: true, name })
}

export async function onRequestDelete({ env, params, data }) {
  const id = Number(params.id)
  if (!(await mine(env, id, data.staff.id))) return fail(404, 'This device is no longer logged in.')
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run()
  await audit(env, data.staff.email, 'logout_device', 'staff', data.staff.id, { session: id })
  const res = json({ ok: true, current: id === data.sessionId })
  if (id === data.sessionId) res.headers.append('Set-Cookie', clearCookie())
  return res
}
