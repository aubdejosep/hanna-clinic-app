// DELETE /api/appointments/:id/items/:itemId  -> takes a service or product off the appointment

import { json, fail, audit } from '../../../../../lib/http.js'
import { syncVisitStock } from '../../../../../lib/stock.js'
import { loadFull } from '../../[id].js'

export async function onRequestDelete({ env, params, data }) {
  const id = Number(params.id)
  const item = await env.DB.prepare('SELECT * FROM appointment_items WHERE id = ? AND appointment_id = ? AND deleted_at IS NULL').bind(Number(params.itemId), id).first()
  if (!item) return fail(404, 'This item was not found.')
  await env.DB.prepare('UPDATE appointment_items SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(new Date().toISOString(), data.staff.email, item.id).run()
  await syncVisitStock(env, id, data.staff) // only changes stock on a visit already paid and checked out
  await audit(env, data.staff.email, 'remove_item', 'appointment', id, { name: item.name, detail: item.detail })
  return json({ appointment: await loadFull(env, id) })
}
