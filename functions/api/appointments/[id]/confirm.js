// POST /api/appointments/:id/confirm {items: [...], checkOut} -> "Anything else given?" at Check Out:
//   adds what was missing, marks the list as complete, and with checkOut also checks the pet out.
//   A visit checked out with a tag tap gets a Confirm Items reminder until this is done.

import { json, fail, readJson, audit } from '../../../../lib/http.js'
import { itemRows, insertItems, moveTo } from '../../../../lib/appointments.js'
import { loadFull } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')
  if (['cancelled', 'no_show'].includes(appt.status)) return fail(400, 'This appointment is closed, so there is nothing to confirm.')
  if (body.checkOut && appt.status === 'completed') return fail(400, 'This visit is already checked out. Reload to see it.')
  const rows = await itemRows(env, body.items, { actor: data.staff.name })
  const had = await env.DB.prepare('SELECT COUNT(*) AS n FROM appointment_items WHERE appointment_id = ? AND deleted_at IS NULL').bind(id).first()
  if (!had.n && !rows.length) return fail(400, 'Add at least the main service first, then confirm.')
  if (body.checkOut) {
    const res = await moveTo(env, appt, 'completed', { actor: data.staff.name })
    if (res.error) return fail(400, res.error)
  }
  await env.DB.batch([
    ...insertItems(env, id, rows, data.staff.name),
    env.DB.prepare('UPDATE appointments SET items_confirmed_at = ?, items_confirmed_by = ? WHERE id = ?').bind(new Date().toISOString(), data.staff.name, id),
  ])
  await audit(env, data.staff.email, 'confirm_items', 'appointment', id, { added: rows.map((r) => [r.name, r.detail].filter(Boolean).join(' · ')), checkOut: !!body.checkOut })
  return json({ appointment: await loadFull(env, id) })
}
