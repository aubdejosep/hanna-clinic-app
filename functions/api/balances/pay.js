// POST /api/balances/pay {type: owed|invoice, id, amount, method, reference, note} -> a payment against a
//   balance (every staff member). A visit checked out without a payment is paid on the visit instead.

import { json, fail, readJson, clean, manilaToday, audit } from '../../../lib/http.js'
import { METHODS } from '../../../lib/stock.js'
import { toCents } from '../../../lib/services.js'
import { findItem } from '../../../lib/balances.js'

export async function onRequestPost({ request, env, data }) {
  const b = (await readJson(request)) || {}
  if (!['owed', 'invoice'].includes(b.type)) return fail(400, 'Open the visit and use Take Payment for this one.')
  const item = await findItem(env, b.type, b.id)
  if (!item) return fail(404, 'This balance is already settled. Reload to see the latest.')
  if (!METHODS[b.method] || b.method === 'no_charge') return fail(400, 'Choose how they paid.', { errors: { method: 'Choose how they paid.' } })
  const amount = toCents(b.amount)
  const left = Math.round(item.left * 100)
  if (!amount) return fail(400, 'Enter the amount paid, e.g. 500.', { errors: { amount: 'Enter the amount paid, e.g. 500.' } })
  if (amount > left) return fail(400, `That’s more than what’s left (₱${(left / 100).toLocaleString('en-PH')}).`, { errors: { amount: 'Enter up to what’s left.' } })
  const now = new Date().toISOString()
  await env.DB.prepare(`INSERT INTO payments (appointment_id, old_invoice_id, owner_id, kind, at, day, due_cents, amount_cents, method, reference, note, staff_id, staff_name)
    VALUES (?, ?, ?, 'balance', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(b.type === 'owed' ? item.id : null, b.type === 'invoice' ? item.id : null, item.ownerId, now, manilaToday(), left, amount, b.method,
      clean(b.reference, 60) || null, clean(b.note, 200) || null, data.staff.id, data.staff.name).run()
  await audit(env, data.staff.email, 'balance_payment', 'owner', item.ownerId, { type: b.type, id: item.id, amount, method: b.method })
  return json({ left: (left - amount) / 100 }, 201)
}
