// PATCH  /api/content/events/:id {kind, title, from, to, note} -> owners and admins
// DELETE /api/content/events/:id -> owners and admins; hidden, never erased

import { json, fail, readJson, canManage, audit } from '../../../../lib/http.js'
import { eventOut } from '../../../../lib/content.js'
import { eventInput } from './index.js'

export async function onRequestPatch({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change promos and events.')
  const { errors, values: v } = eventInput(await readJson(request))
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  const e = await env.DB.prepare(`UPDATE content_events SET kind = ?, title = ?, start_day = ?, end_day = ?, note = ?, updated_at = ?, updated_by = ?
    WHERE id = ? AND deleted_at IS NULL RETURNING *`).bind(v.kind, v.title, v.start_day, v.end_day, v.note, new Date().toISOString(), data.staff.name, Number(params.id)).first()
  if (!e) return fail(404, 'This event was not found.')
  await audit(env, data.staff.email, 'update', 'content_event', e.id)
  return json({ event: eventOut(e) })
}

export async function onRequestDelete({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can remove promos and events.')
  const r = await env.DB.prepare('UPDATE content_events SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(new Date().toISOString(), data.staff.name, Number(params.id)).run()
  if (!r.meta.changes) return fail(404, 'This event was not found.')
  await audit(env, data.staff.email, 'delete', 'content_event', Number(params.id))
  return json({ ok: true })
}
