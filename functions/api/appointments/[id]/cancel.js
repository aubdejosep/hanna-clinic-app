// POST /api/appointments/:id/cancel {reason}  -> Cancelled, with the reason

import { json, fail, readJson, clean, audit } from '../../../../lib/http.js'
import { moveTo } from '../../../../lib/appointments.js'
import { loadFull } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')
  const reason = clean(body.reason, 200)
  if (!reason) return fail(400, 'Say why it is cancelled.', { errors: { reason: 'Choose or type a reason.' } })
  const res = await moveTo(env, appt, 'cancelled', { actor: data.staff.name })
  if (res.error) return fail(400, res.error)
  await env.DB.prepare('UPDATE appointments SET cancel_reason = ? WHERE id = ?').bind(reason, id).run()
  await audit(env, data.staff.email, 'cancel', 'appointment', id, { reason })
  return json({ appointment: await loadFull(env, id) })
}
