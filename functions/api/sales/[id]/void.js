// POST /api/sales/:id/void {reason} -> voids a sale (owners): the payment is voided and the stock goes back.

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'
import { applyMovements } from '../../../../lib/stock.js'
import { loadSales } from '../index.js'

export async function onRequestPost({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can void a sale.')
  const id = Number(params.id)
  const reason = clean(((await readJson(request)) || {}).reason, 200)
  if (!reason) return fail(400, 'Say why the sale is being voided.', { errors: { reason: 'Say why, e.g. rang up the wrong item.' } })
  const now = new Date().toISOString()
  const res = await env.DB.prepare('UPDATE sales SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL').bind(now, data.staff.name, reason, id).run()
  if (!res.meta.changes) return fail(400, 'This sale was not found, or is already voided.')
  const { results } = await env.DB.prepare('SELECT product_id, SUM(qty) AS q FROM stock_movements WHERE sale_id = ? GROUP BY product_id').bind(id).all()
  await applyMovements(env, results.map((r) => ({ productId: r.product_id, qty: -r.q, kind: 'reversal', reason: `Sale voided: ${reason}`, saleId: id, staff: data.staff })),
    [env.DB.prepare('UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ? WHERE sale_id = ? AND voided_at IS NULL').bind(now, data.staff.name, reason, id)])
  await audit(env, data.staff.email, 'void_sale', 'sale', id, { reason })
  return json({ sale: (await loadSales(env, 's.id = ?', [id]))[0] })
}
