// DELETE /api/inbox/notes/:id -> its author, or an owner or admin; hidden, never erased

import { json, fail, canManage } from '../../../../lib/http.js'

export async function onRequestDelete({ env, params, data }) {
  const n = await env.DB.prepare('SELECT id, staff_id FROM inbox_notes WHERE id = ? AND deleted_at IS NULL').bind(Number(params.id)).first()
  if (!n) return fail(404, 'This note was not found.')
  if (n.staff_id !== data.staff.id && !canManage(data.staff)) return fail(403, 'Only the person who wrote it, or an owner, can remove a note.')
  await env.DB.prepare('UPDATE inbox_notes SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(new Date().toISOString(), data.staff.name, n.id).run()
  return json({ ok: true })
}
