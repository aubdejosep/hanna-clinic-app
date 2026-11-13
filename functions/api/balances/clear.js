// POST /api/balances/clear {type: owed|invoice, id, reason} -> owners and admins clear what's left of a
//   balance, e.g. an old invoice that was settled but never updated. Kept on record with the reason.

import { json, fail, readJson, clean, canManage, audit } from '../../../lib/http.js'
import { findItem } from '../../../lib/balances.js'

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can clear a balance.')
  const b = (await readJson(request)) || {}
  if (!['owed', 'invoice'].includes(b.type)) return fail(400, 'Open the visit and use Take Payment (or No Charge) for this one.')
  const reason = clean(b.reason, 200)
  if (!reason) return fail(400, 'Say why it’s being cleared.', { errors: { reason: 'Say why, e.g. paid in cash in 2025, not recorded.' } })
  const item = await findItem(env, b.type, b.id)
  if (!item) return fail(404, 'This balance is already settled. Reload to see the latest.')
  const amount = Math.round(item.left * 100)
  await env.DB.prepare('INSERT INTO balance_clears (appointment_id, old_invoice_id, owner_id, amount_cents, reason, at, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(b.type === 'owed' ? item.id : null, b.type === 'invoice' ? item.id : null, item.ownerId, amount, reason, new Date().toISOString(), data.staff.name).run()
  await audit(env, data.staff.email, 'balance_clear', 'owner', item.ownerId, { type: b.type, id: item.id, amount, reason })
  return json({ ok: true })
}
