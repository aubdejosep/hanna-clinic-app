// POST /api/inventory/:id/adjust {qty, direction: in|out, reason, note} -> stock changed outside a visit or
//   sale (expired, damaged, used in clinic, lost, found…). Everyone can; who and why are kept.

import { json, fail, readJson, clean, audit } from '../../../../lib/http.js'
import { ADJUST_REASONS, applyMovements } from '../../../../lib/stock.js'
import { qtyOf } from '../../../../lib/inventory.js'
import { loadProduct } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const p = await env.DB.prepare('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!p) return fail(404, 'This product was not found.')
  const qty = qtyOf(body.qty)
  if (!(qty > 0)) return fail(400, 'Enter how many.', { errors: { qty: 'Enter how many.' } })
  if (!ADJUST_REASONS.includes(body.reason)) return fail(400, 'Choose a reason.', { errors: { reason: 'Choose a reason.' } })
  const note = clean(body.note, 200)
  if (['Lost or Missing', 'Correction'].includes(body.reason) && !note) return fail(400, 'Add a short note for this reason.', { errors: { note: 'Say what happened.' } })
  const sign = body.direction === 'in' || ['Found'].includes(body.reason) ? 1 : -1
  await applyMovements(env, [{ productId: id, qty: sign * qty, kind: 'adjust', reason: note ? `${body.reason}: ${note}` : body.reason, staff: data.staff }])
  await audit(env, data.staff.email, 'adjust_stock', 'product', id, { qty: sign * qty, reason: body.reason, note })
  return json({ product: await loadProduct(env, id) })
}
