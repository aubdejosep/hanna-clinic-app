// POST /api/auth/password {current, next} -> changes the logged-in person's own password.
// Every other device logged in to this account is logged out; this one stays logged in.

import { json, fail, readJson, audit } from '../../../lib/http.js'
import { checkPassword, hashPassword, passwordProblem } from '../../../lib/password.js'

export async function onRequestPost({ request, env, data }) {
  const body = (await readJson(request)) || {}
  const current = typeof body.current === 'string' ? body.current.slice(0, 200) : ''
  const next = typeof body.next === 'string' ? body.next : ''

  const row = await env.DB.prepare('SELECT password_hash FROM staff WHERE id = ?').bind(data.staff.id).first()
  if (!row || !(await checkPassword(current, row.password_hash))) {
    return fail(400, "Your current password isn't right. Check it and try again.", { errors: { current: "This isn't your current password." } })
  }
  const problem = passwordProblem(next)
  if (problem) return fail(400, problem, { errors: { next: problem } })
  if (next === current) return fail(400, 'Choose a password different from your current one.', { errors: { next: 'Choose a password different from your current one.' } })

  const now = new Date().toISOString()
  const others = await env.DB.batch([
    env.DB.prepare('UPDATE staff SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(next), now, data.staff.id),
    env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE staff_id = ? AND id != ? AND revoked_at IS NULL')
      .bind(now, data.staff.id, data.sessionId),
  ])
  const loggedOut = others[1].meta.changes || 0
  await audit(env, data.staff.email, 'change_password', 'staff', data.staff.id, { otherDevicesLoggedOut: loggedOut })
  return json({ ok: true, otherDevicesLoggedOut: loggedOut })
}
