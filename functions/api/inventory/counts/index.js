// GET  /api/inventory/counts -> stock counts, newest first, with what each found missing or extra
// POST /api/inventory/counts {note} -> starts a count (owners). The first one is the baseline: the
//        opening stock everything after is measured from.

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT c.*, COUNT(l.product_id) AS lines,
      SUM(CASE WHEN l.counted < l.expected THEN (l.expected - l.counted) * COALESCE(p.cost_cents, 0) ELSE 0 END) AS missing_cents,
      SUM(CASE WHEN l.counted > l.expected THEN (l.counted - l.expected) * COALESCE(p.cost_cents, 0) ELSE 0 END) AS extra_cents,
      SUM(l.counted < l.expected) AS missing_lines
    FROM stock_counts c LEFT JOIN stock_count_lines l ON l.count_id = c.id LEFT JOIN products p ON p.id = l.product_id
    WHERE c.cancelled_at IS NULL GROUP BY c.id ORDER BY c.id DESC LIMIT 50`).all()
  return json({ counts: results.map(countOut) })
}

export function countOut(c) {
  return {
    id: c.id, kind: c.kind, startedAt: c.started_at, startedBy: c.started_by, finishedAt: c.finished_at, finishedBy: c.finished_by, note: c.note,
    lines: c.lines ?? 0, missingValue: Math.round(c.missing_cents || 0) / 100, extraValue: Math.round(c.extra_cents || 0) / 100, missingLines: c.missing_lines || 0,
  }
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can start a stock count.')
  const body = (await readJson(request)) || {}
  const open = await env.DB.prepare('SELECT id FROM stock_counts WHERE finished_at IS NULL AND cancelled_at IS NULL LIMIT 1').first()
  if (open) return fail(409, 'A count is already open. Finish or cancel it first.', { countId: open.id })
  const done = await env.DB.prepare('SELECT 1 FROM stock_counts WHERE finished_at IS NOT NULL LIMIT 1').first()
  const row = await env.DB.prepare('INSERT INTO stock_counts (kind, started_at, started_by, note) VALUES (?, ?, ?, ?) RETURNING id, kind')
    .bind(done ? 'count' : 'baseline', new Date().toISOString(), data.staff.name, clean(body.note, 200) || null).first()
  await audit(env, data.staff.email, 'start_count', 'stock_count', row.id, { kind: row.kind })
  return json({ count: { id: row.id, kind: row.kind } }, 201)
}
