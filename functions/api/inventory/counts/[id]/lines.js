// PUT /api/inventory/counts/:id/lines {productId, counted, expiry, unit, packSize} -> one product counted
//   (saved as it's typed; a new number replaces the old one). The baseline count can also set the unit.

import { json, fail, readJson, isoDay } from '../../../../../lib/http.js'
import { UNITS } from '../../../../../lib/stock.js'
import { qtyOf } from '../../../../../lib/inventory.js'

export async function onRequestPut({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const count = await env.DB.prepare('SELECT * FROM stock_counts WHERE id = ? AND finished_at IS NULL AND cancelled_at IS NULL').bind(id).first()
  if (!count) return fail(400, 'This count is closed. Reload to see it.')
  const p = await env.DB.prepare('SELECT id, on_hand FROM products WHERE id = ? AND deleted_at IS NULL').bind(Number(body.productId)).first()
  if (!p) return fail(404, 'This product was not found.')
  const writes = []
  if (count.kind === 'baseline' && UNITS.includes(body.unit)) writes.push(env.DB.prepare('UPDATE products SET unit = ?, updated_at = ? WHERE id = ?').bind(body.unit, new Date().toISOString(), p.id))
  if (count.kind === 'baseline' && body.packSize !== undefined) {
    const n = qtyOf(body.packSize)
    writes.push(env.DB.prepare('UPDATE products SET pack_size = ?, updated_at = ? WHERE id = ?').bind(n > 0 ? n : null, new Date().toISOString(), p.id))
  }
  if (body.counted !== undefined && body.counted !== '' && body.counted !== null) {
    const counted = qtyOf(body.counted)
    if (counted === null || counted < 0) return fail(400, 'Enter the number on the shelf, e.g. 12.', { errors: { counted: 'Enter a number.' } })
    const expiry = body.expiry ? isoDay(body.expiry) : null
    // The expected figure is what the app says is on hand at the moment it's counted, so visits during the count still add up.
    writes.push(env.DB.prepare(`INSERT INTO stock_count_lines (count_id, product_id, expected, counted, expiry, counted_by, counted_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (count_id, product_id) DO UPDATE SET expected = excluded.expected, counted = excluded.counted, expiry = excluded.expiry,
        counted_by = excluded.counted_by, counted_at = excluded.counted_at`).bind(id, p.id, p.on_hand, counted, expiry, data.staff.name, new Date().toISOString()))
  } else if (body.expiry !== undefined) {
    writes.push(env.DB.prepare('UPDATE stock_count_lines SET expiry = ? WHERE count_id = ? AND product_id = ?').bind(body.expiry ? isoDay(body.expiry) : null, id, p.id))
  }
  if (writes.length) await env.DB.batch(writes)
  return json({ ok: true })
}
