// POST /api/appointments/:id/status {to, assignMe} -> the next step (Arrived, Started, Inpatient, Dispense, Completed…);
//                                         assignMe adds the caller to Staff Assignment (Call Next)
// POST /api/appointments/:id/status {undo}  -> back to the step before the latest change

import { json, fail, readJson, audit } from '../../../../lib/http.js'
import { moveTo, STAMP, undoTarget, startsAt } from '../../../../lib/appointments.js'
import { syncVisit } from '../../../../lib/visitRecord.js'
import { loadFull } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the step as JSON.')
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')

  if (body.undo) {
    if (appt.status === 'completed') return fail(400, 'This visit is checked out and the client has left, so its steps can’t be undone. Add a Staff Note to record any correction.')
    const { results: events } = await env.DB.prepare('SELECT from_status AS "from", to_status AS "to", via, actor FROM appointment_events WHERE appointment_id = ? ORDER BY at, id').bind(id).all()
    const step = undoTarget(events, appt.status)
    if (!step) return fail(400, 'There is no step to undo.')
    const last = { from_status: step.from }
    // Undoing a check-in that moved a booking from another day to today puts it back on its day.
    const moved = (step.actor || '').match(/\(booked for (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?, moved to today\)/)
    const back = moved && step.to === 'arrived' ? { day: moved[1], time: moved[2] || appt.time } : null
    if (await env.DB.prepare('SELECT 1 FROM appointments WHERE rescheduled_from = ? AND deleted_at IS NULL').bind(id).first()) {
      return fail(400, 'This appointment was rescheduled. Open the new appointment instead.')
    }
    const now = new Date().toISOString()
    const stamp = STAMP[appt.status]
    await env.DB.batch([
      env.DB.prepare(`UPDATE appointments SET status = ?, updated_at = ?${stamp ? `, ${stamp} = NULL` : ''}${appt.status === 'cancelled' ? ', cancel_reason = NULL' : ''}${appt.status === 'completed' ? ', items_confirmed_at = NULL, items_confirmed_by = NULL' : ''} ${back ? ', day = ?, time = ?, starts_at = ?' : ''} WHERE id = ?`)
        .bind(last.from_status, now, ...(back ? [back.day, back.time, startsAt(back.day, back.time)] : []), id),
      env.DB.prepare('INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, now, appt.status, last.from_status, 'button', `${data.staff.name} (undo)`),
    ])
    await syncVisit(env, id, data.staff) // undoing a check-out puts its stock back
    await audit(env, data.staff.email, 'undo_status', 'appointment', id, { from: appt.status, to: last.from_status })
    return json({ appointment: await loadFull(env, id) })
  }

  const to = String(body.to || '')
  if (to === 'cancelled') return fail(400, 'Use Cancel, so the reason is saved.')
  const res = await moveTo(env, appt, to, { actor: data.staff.name, staffId: data.staff.id })
  if (res.error) return fail(400, res.error)
  if (body.assignMe) await env.DB.prepare('INSERT OR IGNORE INTO appointment_staff (appointment_id, staff_id) VALUES (?, ?)').bind(id, data.staff.id).run()
  await audit(env, data.staff.email, 'status', 'appointment', id, { from: appt.status, to })
  return json({ appointment: await loadFull(env, id) })
}
