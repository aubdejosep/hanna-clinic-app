// GET    /api/inventory/counts/:id -> the count with every active product: on hand now, and what was counted
// DELETE /api/inventory/counts/:id -> cancels an open count (owners); nothing changes in stock

import { json, fail, canManage, audit } from '../../../../lib/http.js'
import { countOut } from './index.js'

export async function loadCount(env, id) {
  const [c, rows] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM stock_counts WHERE id = ?').bind(id),
    env.DB.prepare(`SELECT p.id, p.name, p.category, p.unit, p.pack_name, p.pack_size, p.on_hand, p.cost_cents, p.active,
        l.expected, l.counted, l.expiry, l.counted_by, l.counted_at,
        (SELECT MIN(b.expiry) FROM stock_batches b WHERE b.product_id = p.id AND b.remaining > 0 AND b.expiry IS NOT NULL) AS nearest_expiry
      FROM products p LEFT JOIN stock_count_lines l ON l.product_id = p.id AND l.count_id = ?
      WHERE p.deleted_at IS NULL AND (p.active = 1 OR l.count_id IS NOT NULL) ORDER BY p.category, p.name COLLATE NOCASE`).bind(id),
  ])
  const count = c.results[0]
  if (!count || count.cancelled_at) return null
  const finished = !!count.finished_at
  const lines = rows.results.filter((r) => r.counted != null)
  const value = (sign) => lines.reduce((n, r) => n + Math.max(0, sign * (r.counted - r.expected)) * (r.cost_cents || 0), 0)
  return {
    ...countOut({ ...count, lines: lines.length, missing_cents: value(-1), extra_cents: value(1), missing_lines: lines.filter((r) => r.counted < r.expected).length }),
    products: rows.results.filter((r) => !finished || r.counted != null).map((r) => ({
      id: r.id, name: r.name, category: r.category || 'Other', unit: r.unit, packName: r.pack_name, packSize: r.pack_size,
      onHand: r.on_hand, cost: r.cost_cents == null ? null : r.cost_cents / 100, nearestExpiry: r.nearest_expiry,
      counted: r.counted, expected: r.expected, expiry: r.expiry, countedBy: r.counted_by, countedAt: r.counted_at,
    })),
  }
}

export async function onRequestGet({ env, params }) {
  const count = await loadCount(env, Number(params.id))
  return count ? json({ count }) : fail(404, 'This count was not found.')
}

export async function onRequestDelete({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can cancel a count.')
  const id = Number(params.id)
  const res = await env.DB.prepare('UPDATE stock_counts SET cancelled_at = ?, cancelled_by = ? WHERE id = ? AND finished_at IS NULL AND cancelled_at IS NULL')
    .bind(new Date().toISOString(), data.staff.name, id).run()
  if (!res.meta.changes) return fail(400, 'Only an open count can be cancelled.')
  await audit(env, data.staff.email, 'cancel_count', 'stock_count', id)
  return json({ ok: true })
}
