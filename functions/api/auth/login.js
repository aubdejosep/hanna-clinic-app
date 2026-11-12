// POST /api/auth/login {email, password, remember} -> { staff } and the session cookie
//
// Guessing is slowed two ways: 5 wrong passwords lock that account for 15 minutes, and
// 30 failures from one network in 15 minutes pause logins from there. The reply never says
// whether the email exists.

import { json, fail, readJson, clean, audit } from '../../../lib/http.js'
import { checkPassword } from '../../../lib/password.js'
import { ipOf, sha256, startSession } from '../../../lib/auth.js'

const MAX_TRIES = 5
const LOCK_MINUTES = 15
const NETWORK_LIMIT = 30
// Checked when the email isn't found, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const NO_MATCH = "That email and password don't match. Check them and try again."

export async function onRequestPost({ request, env }) {
  const body = await readJson(request)
  const email = clean(body?.email, 100).toLowerCase()
  const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : ''
  if (!email || !password) return fail(400, 'Enter your email and password.')

  const now = new Date()
  const since = new Date(now.getTime() - LOCK_MINUTES * 60 * 1000).toISOString()
  const ipHash = await sha256(`login:${request.headers.get('CF-Connecting-IP') || 'local'}`)
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip_hash = ? AND at > ?').bind(ipHash, since).first()
  if (recent.n >= NETWORK_LIMIT) {
    return fail(429, `Too many wrong passwords from this network. Wait ${LOCK_MINUTES} minutes, then try again.`)
  }

  const staff = await env.DB.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').bind(email).first()
  if (staff?.locked_until && staff.locked_until > now.toISOString()) {
    const mins = Math.max(1, Math.ceil((Date.parse(staff.locked_until) - now.getTime()) / 60000))
    return fail(423, `This account is paused for ${mins} more minute${mins > 1 ? 's' : ''} after too many wrong passwords. Wait, or ask a clinic owner to set a new password.`)
  }

  const ok = await checkPassword(password, staff?.password_hash || DUMMY_HASH)
  if (!ok || !staff?.password_hash) {
    const writes = [
      env.DB.prepare('INSERT INTO login_failures (ip_hash) VALUES (?)').bind(ipHash),
      env.DB.prepare('DELETE FROM login_failures WHERE at < ?').bind(new Date(now.getTime() - 86400000).toISOString()),
    ]
    if (staff) {
      const tries = staff.failed_logins + 1
      writes.push(tries >= MAX_TRIES
        ? env.DB.prepare('UPDATE staff SET failed_logins = 0, locked_until = ? WHERE id = ?')
          .bind(new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString(), staff.id)
        : env.DB.prepare('UPDATE staff SET failed_logins = ? WHERE id = ?').bind(tries, staff.id))
    }
    await env.DB.batch(writes)
    if (staff && staff.failed_logins + 1 >= MAX_TRIES) {
      await audit(env, staff.email, 'locked', 'staff', staff.id, { minutes: LOCK_MINUTES })
      return fail(423, `Too many wrong passwords. This account is paused for ${LOCK_MINUTES} minutes. Wait, or ask a clinic owner to set a new password.`)
    }
    return fail(401, NO_MATCH)
  }

  await env.DB.prepare('UPDATE staff SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
    .bind(now.toISOString(), staff.id).run()
  const cookie = await startSession(env, staff.id, !!body.remember, request.headers.get('User-Agent'), ipOf(request))
  await audit(env, staff.email, 'login', 'staff', staff.id, { remember: !!body.remember })

  const res = json({ staff: { id: staff.id, email: staff.email, name: `${staff.first_name} ${staff.last_name}`.trim(), role: staff.role } })
  res.headers.append('Set-Cookie', cookie)
  return res
}
