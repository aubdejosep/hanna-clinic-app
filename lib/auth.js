// Who is calling the API?
//
// Login is Cloudflare Access (one-time PIN sent to the staff member's email), the same as the
// website's /staff page. Access sits in front of app.hannapetwellnesscenter.com, and this code
// also checks the Access token itself (signature, application, expiry), so a preview link that
// skips Access gets nothing. The email must then belong to an active row in the staff table;
// ADMIN_EMAILS lets the owner in before any staff rows exist.
//
// Settings (Pages project -> Settings -> Variables and Secrets):
//   ACCESS_TEAM_DOMAIN  e.g. hanna.cloudflareaccess.com  (Zero Trust -> Settings -> Team domain)
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//   ADMIN_EMAILS        comma-separated; always allowed in, as admin
//   DEV_LOGIN_EMAIL     local development only (.dev.vars): skips Access on localhost

function b64urlBytes(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
function b64urlJson(part) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(part)))
}

let certCache = { at: 0, team: '', keys: [] }
async function accessKeys(env, team) {
  if (certCache.team === team && Date.now() - certCache.at < 10 * 60 * 1000 && certCache.keys.length) return certCache.keys
  const res = await fetch(env.ACCESS_CERTS_URL || `https://${team}/cdn-cgi/access/certs`)
  const keys = (await res.json()).keys || []
  certCache = { at: Date.now(), team, keys }
  return keys
}

async function accessEmail(request, env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!team || !env.ACCESS_AUD) return { error: 'not_setup' }
  const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || (cookie && cookie[1])
  if (!token) return { error: 'login' }
  try {
    const [h, p, s] = token.split('.')
    const header = b64urlJson(h)
    const claims = b64urlJson(p)
    const jwk = (await accessKeys(env, team)).find((k) => k.kid === header.kid)
    if (!jwk || header.alg !== 'RS256') return { error: 'login' }
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`))
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!ok || !aud.includes(env.ACCESS_AUD) || claims.exp < Date.now() / 1000 || claims.iss !== `https://${team}`) return { error: 'login' }
    return { email: String(claims.email || '').toLowerCase() }
  } catch {
    return { error: 'login' }
  }
}

function isLocal(request) {
  const host = new URL(request.url).hostname
  return host === 'localhost' || host === '127.0.0.1'
}

// -> { staff: {id, email, name, role, title} } or { error, email? }
export async function currentStaff(request, env) {
  if (!env.DB) return { error: 'not_setup' }
  const found = env.DEV_LOGIN_EMAIL && isLocal(request)
    ? { email: env.DEV_LOGIN_EMAIL.toLowerCase() }
    : await accessEmail(request, env)
  if (found.error) return found

  const row = await env.DB.prepare('SELECT id, email, first_name, last_name, title, role FROM staff WHERE email = ? AND active = 1')
    .bind(found.email).first()
  if (row) {
    return { staff: { id: row.id, email: row.email, name: `${row.first_name} ${row.last_name}`.trim(), role: row.role, title: row.title } }
  }
  const admins = String(env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (admins.includes(found.email)) {
    return { staff: { id: null, email: found.email, name: found.email.split('@')[0], role: 'admin', title: 'Owner' } }
  }
  return { error: 'forbidden', email: found.email }
}

export const AUTH_ERRORS = {
  not_setup: [503, 'The app is not set up yet. See the README: "Go live".'],
  login: [401, 'Please log in again.'],
  forbidden: [403, 'This email is not on the staff list. Ask the clinic owner to add you.'],
}
