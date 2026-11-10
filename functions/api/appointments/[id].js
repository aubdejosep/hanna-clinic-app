// GET   /api/appointments/:id  -> the appointment with its pet, items, staff, notes, history and
//                                  the appointments it was rescheduled from / to
// PATCH /api/appointments/:id  {emergency, reason, staffIds}  -> saves only the fields sent

import { json, fail, readJson, cleanMultiline, audit } from '../../../lib/http.js'
import { petOut } from '../../../lib/clients.js'
import { loadAppointment, apptNo, NEXT } from '../../../lib/appointments.js'

export async function loadFull(env, id) {
  const appt = await loadAppointment(env, id)
  if (!appt) return null
  const [pet, items, staff, notes, events, from, to, tag] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(appt.pet.id),
    env.DB.prepare('SELECT * FROM appointment_items WHERE appointment_id = ? AND deleted_at IS NULL ORDER BY id').bind(id),
    env.DB.prepare(`SELECT s.id, s.first_name, s.last_name, s.title, s.role FROM appointment_staff x JOIN staff s ON s.id = x.staff_id
      WHERE x.appointment_id = ? ORDER BY s.first_name`).bind(id),
    env.DB.prepare('SELECT * FROM appointment_notes WHERE appointment_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').bind(id),
    env.DB.prepare('SELECT * FROM appointment_events WHERE appointment_id = ? ORDER BY at, id').bind(id),
    env.DB.prepare('SELECT id, day, time, status FROM appointments WHERE id = (SELECT rescheduled_from FROM appointments WHERE id = ?)').bind(id),
    env.DB.prepare('SELECT id, day, time, status FROM appointments WHERE rescheduled_from = ? AND deleted_at IS NULL').bind(id),
    env.DB.prepare('SELECT uid FROM pet_tags WHERE pet_id = ? AND retired_at IS NULL LIMIT 1').bind(appt.pet.id),
  ])
  const link = (r) => r ? { id: r.id, no: apptNo(r), day: r.day, time: r.time, status: r.status } : null
  const history = events.results.map((e) => ({ at: e.at, from: e.from_status, to: e.to_status, via: e.via, actor: e.actor }))
  return {
    ...appt,
    pet: { ...appt.pet, ...petOut(pet.results[0]), tag: tag.results[0]?.uid || null },
    items: items.results.map((i) => ({ id: i.id, serviceId: i.service_id, name: i.name, detail: i.detail, kind: i.kind, qty: i.qty, price: i.price_cents == null ? null : i.price_cents / 100 })),
    staff: staff.results.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`.trim(), title: s.title, role: s.role })),
    notes: notes.results.map((n) => ({ id: n.id, author: n.author, staffId: n.staff_id, body: n.body, at: n.created_at })),
    history,
    canUndo: history.length > 1 && !['booking', 'auto', 'import'].includes(history[history.length - 1].via) && !to.results.length,
    next: NEXT[appt.status] || [],
    from: link(from.results[0]),
    to: link(to.results[0]),
  }
}

export async function onRequestGet({ env, params }) {
  const appt = await loadFull(env, Number(params.id))
  return appt ? json({ appointment: appt }) : fail(404, 'This appointment was not found.')
}

export async function onRequestPatch({ request, env, params, data }) {
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the changes as JSON.')
  const row = await env.DB.prepare('SELECT id FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!row) return fail(404, 'This appointment was not found.')
  const now = new Date().toISOString()
  const stmts = []
  const fields = []
  if ('emergency' in body) { stmts.push(env.DB.prepare('UPDATE appointments SET emergency = ?, updated_at = ? WHERE id = ?').bind(body.emergency ? 1 : 0, now, id)); fields.push('emergency') }
  if ('reason' in body) { stmts.push(env.DB.prepare('UPDATE appointments SET reason = ?, updated_at = ? WHERE id = ?').bind(cleanMultiline(body.reason, 500) || null, now, id)); fields.push('reason') }
  if (Array.isArray(body.staffIds)) {
    const ids = [...new Set(body.staffIds.map(Number).filter(Boolean))].slice(0, 6)
    stmts.push(env.DB.prepare('DELETE FROM appointment_staff WHERE appointment_id = ?').bind(id))
    ids.forEach((s) => stmts.push(env.DB.prepare('INSERT OR IGNORE INTO appointment_staff (appointment_id, staff_id) SELECT ?, id FROM staff WHERE id = ?').bind(id, s)))
    fields.push('staff')
  }
  if (!stmts.length) return fail(400, 'Nothing to change.')
  await env.DB.batch(stmts)
  await audit(env, data.staff.email, 'update', 'appointment', id, { fields })
  return json({ appointment: await loadFull(env, id) })
}
