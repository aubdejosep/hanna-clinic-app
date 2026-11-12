// Device Management: where the logged-in person is logged in (their own devices only).
// GET  /api/me/sessions -> active logins, this one marked current
// POST /api/me/sessions {action: 'logout_others'} -> logs out every other device

import { json, fail, readJson, audit } from '../../../../lib/http.js'

export function sessionOut(s, currentId) {
  return {
    id: s.id, current: s.id === currentId, name: s.device_name, userAgent: s.user_agent, ip: s.ip,
    loggedInAt: s.created_at, lastActiveAt: s.last_seen_at, expiresAt: s.expires_at, remember: !!s.remember,
  }
}

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare(`SELECT * FROM sessions WHERE staff_id = ? AND revoked_at IS NULL AND expires_at > ?
    ORDER BY last_seen_at DESC LIMIT 50`).bind(data.staff.id, new Date().toISOString()).all()
  const list = results.map((s) => sessionOut(s, data.sessionId))
  list.sort((a, b) => b.current - a.current)
  return json({ sessions: list })
}

export async function onRequestPost({ request, env, data }) {
  const b = (await readJson(request)) || {}
  if (b.action !== 'logout_others') return fail(400, 'Choose what to do.')
  const r = await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE staff_id = ? AND id <> ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), data.staff.id, data.sessionId).run()
  await audit(env, data.staff.email, 'logout_others', 'staff', data.staff.id, { devices: r.meta.changes })
  return json({ loggedOut: r.meta.changes })
}
