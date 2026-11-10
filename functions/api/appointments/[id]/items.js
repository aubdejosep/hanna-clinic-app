// POST /api/appointments/:id/items {serviceId, variationId} or {name, detail, kind: custom|product, qty}
//   -> adds a service or product to the appointment

import { json, fail, readJson, audit } from '../../../../lib/http.js'
import { itemRows, insertItems } from '../../../../lib/appointments.js'
import { loadFull } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const appt = await env.DB.prepare('SELECT id, status FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')
  if (appt.status === 'cancelled') return fail(400, 'This appointment is cancelled, so nothing can be added.')
  const rows = await itemRows(env, [body])
  if (!rows.length) return fail(400, 'Choose a service, or type the item’s name.')
  await env.DB.batch(insertItems(env, id, rows, data.staff.name))
  await audit(env, data.staff.email, 'add_item', 'appointment', id, { name: rows[0].name, detail: rows[0].detail })
  return json({ appointment: await loadFull(env, id) }, 201)
}
