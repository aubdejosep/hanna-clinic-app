// Who is calling the API?
//
// Staff log in on the app's own page with email + password (functions/api/auth/login.js).
// A successful login creates a row in `sessions` and gives the browser a random token in an
// HttpOnly cookie; only the token's SHA-256 is stored. "Remember me" keeps the device logged in
// for 30 days, renewed whenever it's used; otherwise the cookie ends when the browser closes and
// the session after 12 hours without use.

export const COOKIE = 'hpw_session'
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000
const SHORT_MS = 12 * 60 * 60 * 1000
const RENEW_AFTER_MS = 10 * 60 * 1000 // don't write to the database on every request

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function sessionCookie(token, remember) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${remember ? `; Max-Age=${REMEMBER_MS / 1000}` : ''}`
}
export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
function readToken(request) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`))
  return m ? m[1] : null
}

export async function startSession(env, staffId, remember, userAgent) {
  const token = randomToken()
  const expires = new Date(Date.now() + (remember ? REMEMBER_MS : SHORT_MS)).toISOString()
  await env.DB.prepare('INSERT INTO sessions (token_hash, staff_id, remember, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), staffId, remember ? 1 : 0, expires, String(userAgent || '').slice(0, 200)).run()
  return sessionCookie(token, remember)
}

export async function endSession(request, env) {
  const token = readToken(request)
  if (token) {
    await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(new Date().toISOString(), await sha256(token)).run()
  }
}

// -> { staff, setCookie? } or { error: 'login' }
export async function currentStaff(request, env) {
  if (!env.DB) return { error: 'not_setup' }
  const token = readToken(request)
  if (!token) return { error: 'login' }
  const row = await env.DB.prepare(`
    SELECT s.id AS session_id, s.remember, s.last_seen_at, s.expires_at,
           st.id, st.email, st.first_name, st.last_name, st.title, st.role
    FROM sessions s JOIN staff st ON st.id = s.staff_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND st.active = 1`).bind(await sha256(token)).first()
  const now = Date.now()
  if (!row || Date.parse(row.expires_at) <= now) return { error: 'login' }

  let setCookie
  if (now - Date.parse(row.last_seen_at) > RENEW_AFTER_MS) {
    const expires = new Date(now + (row.remember ? REMEMBER_MS : SHORT_MS)).toISOString()
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .bind(new Date(now).toISOString(), expires, row.session_id).run()
    if (row.remember) setCookie = sessionCookie(token, true) // push the browser's 30 days forward too
  }
  return {
    staff: { id: row.id, email: row.email, name: `${row.first_name} ${row.last_name}`.trim(), firstName: row.first_name, role: row.role, title: row.title },
    setCookie,
  }
}

export const AUTH_ERRORS = {
  not_setup: [503, 'The app is not set up yet. See the README: "Go live".'],
  login: [401, 'Please log in.'],
}
