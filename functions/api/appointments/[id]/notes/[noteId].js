// DELETE /api/appointments/:id/notes/:noteId  -> removes a note (its author, or a clinic owner)

import { json, fail, canManage, audit } from '../../../../../lib/http.js'

export async function onRequestDelete({ env, params, data }) {
  const note = await env.DB.prepare('SELECT * FROM appointment_notes WHERE id = ? AND appointment_id = ? AND deleted_at IS NULL')
    .bind(Number(params.noteId), Number(params.id)).first()
  if (!note) return fail(404, 'This note was not found.')
  if (note.staff_id !== data.staff.id && !canManage(data.staff)) return fail(403, 'Only the person who wrote this note, or a clinic owner, can remove it.')
  await env.DB.prepare('UPDATE appointment_notes SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(new Date().toISOString(), data.staff.email, note.id).run()
  await audit(env, data.staff.email, 'remove_note', 'appointment', params.id, { noteId: note.id })
  return json({ ok: true })
}
