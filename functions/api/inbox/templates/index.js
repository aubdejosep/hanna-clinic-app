// Quick replies. GET -> every staff member; POST {title, body} -> owners and admins

import { json, fail, readJson, clean, cleanMultiline, canManage, audit } from '../../../../lib/http.js'

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT id, title, body FROM inbox_templates WHERE deleted_at IS NULL ORDER BY sort, id').all()
  return json({ templates: results })
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change quick replies.')
  const b = (await readJson(request)) || {}
  const title = clean(b.title, 60)
  const body = cleanMultiline(b.body, 3000)
  if (!title || !body) return fail(400, 'Give the quick reply a name and its text.', { errors: { ...(title ? {} : { title: 'Name it, e.g. Directions.' }), ...(body ? {} : { body: 'Write the reply.' }) } })
  const row = await env.DB.prepare("INSERT INTO inbox_templates (title, body, sort, created_by) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM inbox_templates), ?) RETURNING id").bind(title, body, data.staff.name).first()
  await audit(env, data.staff.email, 'create', 'inbox_template', row.id)
  return json({ id: row.id }, 201)
}
