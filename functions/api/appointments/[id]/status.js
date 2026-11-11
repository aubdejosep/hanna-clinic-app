// POST /api/appointments/:id/status {to, assignMe} -> the next step (Arrived, Started, Inpatient, Dispense, Completed…);
//                                         assignMe adds the caller to Staff Assignment (Call Next)
// POST /api/appointments/:id/status {undo}  -> back to the step before the latest change

import { json, fail, readJson, audit } from '../../../../lib/http.js'
import { moveTo, STAMP } from '../../../../lib/appointments.js'
import { syncVisitStock } from '../../../../lib/stock.js'
import { loadFull } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the step as JSON.')
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')

  if (body.undo) {
    const last = await env.DB.prepare('SELECT * FROM appointment_events WHERE appointment_id = ? ORDER BY at DESC, id DESC LIMIT 1').bind(id).first()
    if (!last || !last.from_status || last.to_status !== appt.status || ['auto', 'import', 'booking'].includes(last.via)) return fail(400, 'There is no step to undo.')
    if (await env.DB.prepare('SELECT 1 FROM appointments WHERE rescheduled_from = ? AND deleted_at IS NULL').bind(id).first()) {
      return fail(400, 'This appointment was rescheduled. Open the new appointment instead.')
    }
    const now = new Date().toISOString()
    const stamp = STAMP[appt.status]
    await env.DB.batch([
      env.DB.prepare(`UPDATE appointments SET status = ?, updated_at = ?${stamp ? `, ${stamp} = NULL` : ''}${appt.status === 'cancelled' ? ', cancel_reason = NULL' : ''}${appt.status === 'completed' ? ', items_confirmed_at = NULL, items_confirmed_by = NULL' : ''} WHERE id = ?`)
        .bind(last.from_status, now, id),
      env.DB.prepare('INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, now, appt.status, last.from_status, 'button', `${data.staff.name} (undo)`),
    ])
    await syncVisitStock(env, id, data.staff) // undoing a check-out puts its stock back
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
