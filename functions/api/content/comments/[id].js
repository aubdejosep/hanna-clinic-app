// DELETE /api/content/comments/:id -> its author, or an owner or admin; hidden, never erased

import { json, fail, canManage, audit } from '../../../../lib/http.js'

export async function onRequestDelete({ env, params, data }) {
  const id = Number(params.id)
  const c = await env.DB.prepare('SELECT id, staff_id FROM content_comments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!c) return fail(404, 'This comment was not found.')
  if (c.staff_id !== data.staff.id && !canManage(data.staff)) return fail(403, 'Only the person who wrote it, or an owner, can remove a comment.')
  await env.DB.prepare('UPDATE content_comments SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(new Date().toISOString(), data.staff.name, id).run()
  await audit(env, data.staff.email, 'delete', 'content_comment', id)
  return json({ ok: true })
}
