// PATCH /api/inbox/templates/:id {title, body}; DELETE -> owners and admins (hidden, never erased)

import { json, fail, readJson, clean, cleanMultiline, canManage, audit } from '../../../../lib/http.js'

export async function onRequestPatch({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change quick replies.')
  const b = (await readJson(request)) || {}
  const title = clean(b.title, 60)
  const body = cleanMultiline(b.body, 3000)
  if (!title || !body) return fail(400, 'Give the quick reply a name and its text.')
  await env.DB.prepare('UPDATE inbox_templates SET title = ?, body = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').bind(title, body, new Date().toISOString(), Number(params.id)).run()
  await audit(env, data.staff.email, 'update', 'inbox_template', Number(params.id))
  return json({ ok: true })
}

export async function onRequestDelete({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change quick replies.')
  await env.DB.prepare('UPDATE inbox_templates SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(new Date().toISOString(), data.staff.name, Number(params.id)).run()
  await audit(env, data.staff.email, 'delete', 'inbox_template', Number(params.id))
  return json({ ok: true })
}
