// Small helpers shared by the Pages Functions. Lives outside functions/ so it isn't a route.

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
export function fail(status, message, extra = {}) {
  return json({ error: message, ...extra }, status)
}
export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export function clean(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}
export function cleanMultiline(value, max) {
  return typeof value === 'string' ? value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max) : ''
}
export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}
// +639XXXXXXXXX or '' (same rule as the website's booking form)
export function normalizeMobile(raw) {
  const m = String(raw || '').replace(/[^\d+]/g, '').match(/^(?:\+?63|0)?(9\d{9})$/)
  return m ? `+63${m[1]}` : ''
}
export function isoDay(value) {
  const s = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}

// Manila is UTC+8 all year.
const MANILA_MS = 8 * 60 * 60 * 1000
export function manilaToday(now = new Date()) {
  return new Date(now.getTime() + MANILA_MS).toISOString().slice(0, 10)
}

// LIKE pattern for a search box: "shih tz" -> %shih%tz%
export function likePattern(q) {
  const words = clean(q, 80).replace(/[%_\\]/g, '').split(' ').filter(Boolean)
  return words.length ? `%${words.join('%')}%` : null
}
export function pageArgs(url, size = 25) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  return { page, size, offset: (page - 1) * size }
}

export async function audit(env, actor, action, entity, entityId, detail) {
  await env.DB.prepare('INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(actor, action, entity, entityId == null ? null : String(entityId), detail ? JSON.stringify(detail) : null)
    .run()
}
