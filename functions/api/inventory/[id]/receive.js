// POST /api/inventory/:id/receive {qty, packs, packCost, unitCost, expiry, batchNo, supplier}
//   -> stock delivered: a new batch and a Received movement. qty in units, or packs × the pack size.

import { json, fail, readJson, clean, isoDay, manilaToday, audit } from '../../../../lib/http.js'
import { applyMovements } from '../../../../lib/stock.js'
import { toCents } from '../../../../lib/services.js'
import { qtyOf } from '../../../../lib/inventory.js'
import { loadProduct } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const p = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!p) return fail(404, 'This product was not found.')
  const packs = qtyOf(body.packs)
  const qty = packs && p.pack_size ? Math.round(packs * p.pack_size * 1000) / 1000 : qtyOf(body.qty)
  if (!(qty > 0) || qty > 1000000) return fail(400, 'Enter how many came in.', { errors: { qty: 'Enter how many came in.' } })
  let unitCost = null
  if (body.packCost !== undefined && body.packCost !== '' && p.pack_size) unitCost = toCents(body.packCost) == null ? null : Math.round(toCents(body.packCost) / p.pack_size)
  else if (body.unitCost !== undefined && body.unitCost !== '') unitCost = toCents(body.unitCost)
  const expiry = body.expiry ? isoDay(body.expiry) : null
  if (body.expiry && !expiry) return fail(400, 'Check the expiry date.', { errors: { expiry: 'Check the expiry date.' } })
  const batch = await env.DB.prepare(`INSERT INTO stock_batches (product_id, batch_no, expiry, received_qty, remaining, unit_cost_cents, supplier, received_on, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(id, clean(body.batchNo, 40) || null, expiry, qty, qty, unitCost, clean(body.supplier, 60) || null, manilaToday(), data.staff.name).first()
  await applyMovements(env, [{ productId: id, qty, kind: 'receive', batchId: batch.id, unitCostCents: unitCost, staff: data.staff, reason: clean(body.supplier, 60) || null }],
    unitCost != null ? [env.DB.prepare('UPDATE products SET cost_cents = ?, updated_at = ? WHERE id = ?').bind(unitCost, new Date().toISOString(), id)] : [], { batches: false })
  await audit(env, data.staff.email, 'receive_stock', 'product', id, { qty, unitCost, expiry })
  return json({ product: await loadProduct(env, id) }, 201)
}
