// Private Senders (owners and admins): mail to hello@ from these is forwarded to the private mailbox but
// never saved in the app. GET -> the list; POST {pattern: "name@example.com" | "@example.com", note}

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'

export async function onRequestGet({ env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Private Senders are for the clinic owners and admins.')
  const { results } = await env.DB.prepare('SELECT id, pattern, note, created_at, created_by FROM inbox_private_senders WHERE deleted_at IS NULL ORDER BY pattern').all()
  return json({ senders: results.map((r) => ({ id: r.id, pattern: r.pattern, note: r.note, addedBy: r.created_by, at: r.created_at })) })
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Private Senders are for the clinic owners and admins.')
  const b = (await readJson(request)) || {}
  const pattern = clean(b.pattern, 120).toLowerCase()
  if (!/^([^\s@]+@[^\s@]+\.[^\s@]{2,}|@[^\s@]+\.[^\s@]{2,})$/.test(pattern)) return fail(400, 'Enter an email address, or @ and a domain for everyone there (e.g. @mybank.com).', { errors: { pattern: 'e.g. name@example.com or @example.com' } })
  const row = await env.DB.prepare('INSERT INTO inbox_private_senders (pattern, note, created_by) VALUES (?, ?, ?) RETURNING id').bind(pattern, clean(b.note, 120) || null, data.staff.name).first()
  await audit(env, data.staff.email, 'create', 'inbox_private_sender', row.id, { pattern })
  return json({ id: row.id }, 201)
}
