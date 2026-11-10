// POST /api/appointments/:id/notes {body}  -> adds a staff note (clinic-internal)

import { json, fail, readJson, cleanMultiline, audit } from '../../../../lib/http.js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const text = cleanMultiline(body.body, 2000)
  if (!text) return fail(400, 'Write the note first.', { errors: { body: 'Write the note first.' } })
  const appt = await env.DB.prepare('SELECT id FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')
  const note = await env.DB.prepare('INSERT INTO appointment_notes (appointment_id, staff_id, author, body) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(id, data.staff.id, data.staff.name, text).first()
  await audit(env, data.staff.email, 'note', 'appointment', id, { noteId: note.id })
  return json({ note: { id: note.id, author: note.author, staffId: note.staff_id, body: note.body, at: note.created_at } }, 201)
}
