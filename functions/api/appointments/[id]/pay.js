// POST   /api/appointments/:id/pay {items, method, amount, reference, note, owed, checkOut}
//   -> Take Payment at the front desk: adds anything else given ("Anything else given?"), records the
//      payment and marks the items as confirmed. Paid less than the total with owed: the rest
//      becomes the owner's balance (Finances ▸ Balances); without it, the difference is a discount. With checkOut it also checks the pet out. Stock comes
//      off once the visit is both paid and checked out (now, or at the tag tap-out).
// DELETE /api/appointments/:id/pay {reason} -> voids the payment (owners only); the stock goes back.

import { json, fail, readJson, clean, canManage, manilaToday, audit } from '../../../../lib/http.js'
import { itemRows, insertItems, moveTo } from '../../../../lib/appointments.js'
import { METHODS, visitDue } from '../../../../lib/stock.js'
import { syncVisit } from '../../../../lib/visitRecord.js'
import { toCents } from '../../../../lib/services.js'
import { loadFull } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')
  if (['cancelled', 'no_show', 'accepted', 'pending'].includes(appt.status)) return fail(400, 'Payment is taken once the pet is in the clinic. Check them in first.')
  if (appt.payment_status === 'paid') return fail(409, 'This visit is already paid. Reload to see it.')
  if (!METHODS[body.method]) return fail(400, 'Choose how they paid.', { errors: { method: 'Choose how they paid.' } })
  if (body.checkOut && appt.status === 'completed') return fail(400, 'This visit is already checked out. Reload to see it.')

  const rows = await itemRows(env, body.items, { actor: data.staff.name })
  if (rows.length) await env.DB.batch(insertItems(env, id, rows, data.staff.name))
  const had = await env.DB.prepare('SELECT COUNT(*) AS n FROM appointment_items WHERE appointment_id = ? AND deleted_at IS NULL').bind(id).first()
  if (!had.n) return fail(400, 'Add at least the main service first.')
  const due = await visitDue(env, id)
  const amount = body.method === 'no_charge' ? 0 : body.amount === undefined || body.amount === '' ? due : toCents(body.amount)
  if (amount === null) return fail(400, 'Enter the amount paid, e.g. 1500.', { errors: { amount: 'Enter the amount paid, e.g. 1500.' } })
  const owed = body.owed && amount < due && body.method !== 'no_charge' ? due - amount : 0
  const note = clean(body.note, 200) || (owed ? 'Rest owed (balance)' : null)
  if (amount !== due && !note) return fail(400, 'The amount differs from the total. Say why, e.g. a discount.', { errors: { note: 'Say why the amount differs, e.g. senior discount.' } })

  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO payments (appointment_id, kind, owner_id, at, day, due_cents, amount_cents, owed_cents, method, reference, note, staff_id, staff_name)
      VALUES (?, 'visit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, appt.owner_id, now, manilaToday(), due, amount, owed, body.method, clean(body.reference, 60) || null, note, data.staff.id, data.staff.name),
    env.DB.prepare(`UPDATE appointments SET payment_status = 'paid', paid_at = ?, items_confirmed_at = ?, items_confirmed_by = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, data.staff.name, now, id),
  ])
  if (body.checkOut) {
    const res = await moveTo(env, { ...appt, payment_status: 'paid' }, 'completed', { actor: data.staff.name, staffId: data.staff.id })
    if (res.error) return fail(400, res.error)
  } else {
    await syncVisit(env, id, data.staff) // already tapped out: the stock comes off now
  }
  await audit(env, data.staff.email, 'payment', 'appointment', id, { due, amount, owed, method: body.method, added: rows.map((r) => r.name), checkOut: !!body.checkOut })
  return json({ appointment: await loadFull(env, id) })
}

export async function onRequestDelete({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can void a payment.')
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const reason = clean(body.reason, 200)
  if (!reason) return fail(400, 'Say why the payment is being voided.', { errors: { reason: 'Say why, e.g. charged the wrong pet.' } })
  const pay = await env.DB.prepare("SELECT id FROM payments WHERE appointment_id = ? AND kind = 'visit' AND voided_at IS NULL ORDER BY id DESC LIMIT 1").bind(id).first()
  if (!pay) return fail(404, 'There is no payment on this visit to void.')
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').bind(now, data.staff.name, reason, pay.id),
    env.DB.prepare("UPDATE appointments SET payment_status = 'unpaid', paid_at = NULL, updated_at = ? WHERE id = ?").bind(now, id),
  ])
  await syncVisit(env, id, data.staff)
  await audit(env, data.staff.email, 'void_payment', 'appointment', id, { reason })
  return json({ appointment: await loadFull(env, id) })
}
