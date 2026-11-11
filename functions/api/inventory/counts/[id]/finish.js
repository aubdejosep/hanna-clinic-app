// POST /api/inventory/counts/:id/finish -> applies the count (owners): each counted product's stock is set
//   to what was counted, with a Count movement for the difference (missing or extra), and its batches
//   start again from the count with the expiry seen on the shelf. Products not counted are left as they are.

import { json, fail, canManage, manilaToday, audit } from '../../../../../lib/http.js'
import { applyMovements } from '../../../../../lib/stock.js'
import { loadCount } from '../[id].js'

export async function onRequestPost({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can finish a count.')
  const id = Number(params.id)
  const count = await env.DB.prepare('SELECT * FROM stock_counts WHERE id = ? AND finished_at IS NULL AND cancelled_at IS NULL').bind(id).first()
  if (!count) return fail(400, 'This count is already closed.')
  const { results: lines } = await env.DB.prepare(`SELECT l.*, (SELECT MIN(b.expiry) FROM stock_batches b WHERE b.product_id = l.product_id AND b.remaining > 0 AND b.expiry IS NOT NULL) AS old_expiry
    FROM stock_count_lines l WHERE l.count_id = ?`).bind(id).all()
  if (!lines.length) return fail(400, 'Nothing has been counted yet.')
  const claim = await env.DB.prepare('UPDATE stock_counts SET finished_at = ?, finished_by = ? WHERE id = ? AND finished_at IS NULL').bind(new Date().toISOString(), data.staff.name, id).run()
  if (!claim.meta.changes) return fail(400, 'This count is already closed.')
  const now = new Date().toISOString()
  const reason = count.kind === 'baseline' ? 'Opening count' : 'Stock count'
  const moves = lines.map((l) => ({ productId: l.product_id, qty: l.counted - l.expected, kind: 'count', countId: id, reason, staff: data.staff }))
  const extra = lines.flatMap((l) => [
    env.DB.prepare('UPDATE stock_batches SET remaining = 0 WHERE product_id = ? AND remaining <> 0').bind(l.product_id),
    env.DB.prepare(`INSERT INTO stock_batches (product_id, batch_no, expiry, received_qty, remaining, received_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(l.product_id, `COUNT-${id}`, l.expiry || l.old_expiry || null, l.counted, l.counted, manilaToday(), data.staff.name),
    env.DB.prepare('UPDATE products SET counted_at = ? WHERE id = ?').bind(now, l.product_id),
  ])
  await applyMovements(env, moves, extra, { batches: false })
  await audit(env, data.staff.email, 'finish_count', 'stock_count', id, { lines: lines.length })
  return json({ count: await loadCount(env, id) })
}
