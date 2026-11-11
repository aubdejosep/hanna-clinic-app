// POST /api/appointments/:id/reschedule {day, time, reason}
//   -> the old appointment is Cancelled ("Rescheduled") and a new one is booked with the same pet,
//      services and staff, linked both ways (like the old system's "View Original Appointment").

import { json, fail, readJson, clean, isoDay, audit } from '../../../../lib/http.js'
import { moveTo, manilaNow, startsAt, isTime, BOOKED } from '../../../../lib/appointments.js'
import { loadFull } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')
  if (![...BOOKED, 'no_show'].includes(appt.status)) return fail(400, 'Only a booking that hasn’t started can be rescheduled.')

  const day = isoDay(body.day)
  const time = String(body.time || '')
  const errors = {}
  if (!day) errors.day = 'Choose the new day.'
  else if (day < manilaNow().day) errors.day = 'Choose today or a later day.'
  if (!isTime(time)) errors.time = 'Choose the new time.'
  if (day === appt.day && time === appt.time) errors.time = 'Choose a different day or time.'
  if (day && !errors.day) {
    const closed = await env.DB.prepare('SELECT reason FROM closed_dates WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL AND open IS NULL').bind(day).first()
    if (closed) errors.day = `The clinic is closed that day${closed.reason ? ` (${closed.reason})` : ''}. Choose another day.`
  }
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  const reason = clean(body.reason, 200) || null

  const res = await moveTo(env, { ...appt, status: appt.status === 'no_show' ? 'accepted' : appt.status }, 'cancelled', { actor: data.staff.name })
  if (res.error) return fail(400, res.error)
  const me = data.staff
  const created = await env.DB.prepare(`INSERT INTO appointments
    (pet_id, owner_id, day, time, starts_at, status, kind, source, emergency, reason, rescheduled_from, reschedule_reason, booked_by_staff_id, booked_by_name)
    VALUES (?, ?, ?, ?, ?, 'accepted', ?, 'staff', ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(appt.pet_id, appt.owner_id, day, time, startsAt(day, time), appt.kind === 'walk_in' ? 'booking' : appt.kind, appt.emergency,
      appt.reason, id, reason, me.id, me.name)
    .first()
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('UPDATE appointments SET cancel_reason = ? WHERE id = ?').bind(reason ? `Rescheduled: ${reason}` : 'Rescheduled', id),
    env.DB.prepare(`INSERT INTO appointment_items (appointment_id, service_id, variation_id, name, detail, kind, qty, price_cents, added_by)
      SELECT ?, service_id, variation_id, name, detail, kind, qty, price_cents, added_by FROM appointment_items WHERE appointment_id = ? AND deleted_at IS NULL`).bind(created.id, id),
    env.DB.prepare('INSERT INTO appointment_staff (appointment_id, staff_id) SELECT ?, staff_id FROM appointment_staff WHERE appointment_id = ?').bind(created.id, id),
    env.DB.prepare('INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) VALUES (?, ?, NULL, ?, ?, ?)')
      .bind(created.id, now, 'accepted', 'booking', me.name),
  ])
  await audit(env, me.email, 'reschedule', 'appointment', id, { newId: created.id, day, time, reason })
  return json({ appointment: await loadFull(env, created.id) }, 201)
}
