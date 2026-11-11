// PATCH  /api/appointments/:id/record/:entryId {title, description, details} -> edits what a vet wrote
// DELETE /api/appointments/:id/record/:entryId -> takes it off the record (kept in the database, marked removed)
// Vets, owners and admins. The automatic entries (services, vaccines) follow the visit and can't be edited here.
// A prescription's medicines stay on the visit: remove them under Services & Products if they weren't given.

import { json, fail, readJson, audit } from '../../../../../lib/http.js'
import { WRITERS, entryInput } from '../../../../../lib/recordInput.js'

async function load(env, params) {
  return env.DB.prepare(`SELECT e.* FROM medical_entries e JOIN medical_records m ON m.id = e.record_id
    WHERE e.id = ? AND m.appointment_id = ? AND m.source = 'staff' AND e.deleted_at IS NULL`).bind(Number(params.entryId), Number(params.id)).first()
}

export async function onRequestPatch({ request, env, params, data }) {
  if (!WRITERS.includes(data.staff.role)) return fail(403, 'Only vets and clinic owners edit medical records.')
  const e = await load(env, params)
  if (!e) return fail(404, 'This entry was not found.')
  if (e.auto) return fail(400, 'This entry follows the visit by itself. Change the visit instead.')
  const { values, errors } = entryInput({ ...(await readJson(request)), type: e.type }, { partial: true })
  delete values.type
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  const sets = []
  const binds = []
  if ('title' in values) { sets.push('title = ?'); binds.push(values.title || (e.type === 'prescription' ? 'Prescription' : null)) }
  if ('description' in values) { sets.push('description = ?'); binds.push(values.description) }
  if ('details' in values) { sets.push('details = ?'); binds.push(Object.keys(values.details).length ? JSON.stringify(values.details) : null) }
  if (!sets.length) return fail(400, 'Nothing to change.')
  await env.DB.prepare(`UPDATE medical_entries SET ${sets.join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`).bind(...binds, new Date().toISOString(), data.staff.name, e.id).run()
  await audit(env, data.staff.email, 'edit_record', 'medical_entry', e.id, { before: { title: e.title, description: e.description, details: e.details } })
  return json({ ok: true })
}

export async function onRequestDelete({ env, params, data }) {
  if (!WRITERS.includes(data.staff.role)) return fail(403, 'Only vets and clinic owners edit medical records.')
  const e = await load(env, params)
  if (!e) return fail(404, 'This entry was not found.')
  if (e.auto) return fail(400, 'This entry follows the visit by itself. Change the visit instead.')
  await env.DB.prepare('UPDATE medical_entries SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(new Date().toISOString(), data.staff.name, e.id).run()
  await audit(env, data.staff.email, 'remove_record', 'medical_entry', e.id, { type: e.type, title: e.title })
  return json({ ok: true })
}
