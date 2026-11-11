// GET  /api/inventory?q=&category=&filter=low|out|expiring|uncounted -> Product List with stock on hand,
//        nearest expiry and a summary (everyone sees prices and costs)
// POST /api/inventory {name, category, unit, packName, packSize, price, cost, reorderLevel} -> adds a product (owners)

import { json, fail, readJson, canManage, manilaToday, audit } from '../../../lib/http.js'
import { productOut } from '../../../lib/stock.js'
import { productInput } from '../../../lib/inventory.js'

const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url)
  const soon = addDays(manilaToday(), 60)
  const [rows, counts, open] = await env.DB.batch([
    env.DB.prepare(`SELECT p.*, (SELECT MIN(b.expiry) FROM stock_batches b WHERE b.product_id = p.id AND b.remaining > 0 AND b.expiry IS NOT NULL) AS nearest_expiry
      FROM products p WHERE p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE`),
    env.DB.prepare('SELECT MAX(finished_at) AS last FROM stock_counts WHERE finished_at IS NOT NULL'),
    env.DB.prepare('SELECT id, kind FROM stock_counts WHERE finished_at IS NULL AND cancelled_at IS NULL ORDER BY id DESC LIMIT 1'),
  ])
  const all = rows.results.map(productOut)
  const status = (p) => (!p.countedAt ? 'uncounted' : p.onHand <= 0 ? 'out' : p.reorderLevel != null && p.onHand <= p.reorderLevel ? 'low' : 'ok')
  for (const p of all) { p.status = status(p); p.expiringSoon = !!p.nearestExpiry && p.nearestExpiry <= soon }
  const active = all.filter((p) => p.active)
  const summary = {
    products: active.length,
    value: Math.round(active.reduce((n, p) => n + Math.max(0, p.onHand) * (p.cost || 0), 0)),
    low: active.filter((p) => p.status === 'low').length,
    out: active.filter((p) => p.status === 'out').length,
    expiring: active.filter((p) => p.expiringSoon).length,
    uncounted: active.filter((p) => p.status === 'uncounted').length,
    lastCount: counts.results[0]?.last || null,
    openCount: open.results[0] || null,
  }
  const words = String(url.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean)
  const category = url.searchParams.get('category') || ''
  const filter = url.searchParams.get('filter') || ''
  const list = all.filter((p) => (filter === 'inactive' ? !p.active : p.active)
    && (!category || p.category === category)
    && (!filter || filter === 'inactive' || (filter === 'low' ? ['low', 'out'].includes(p.status) : filter === 'expiring' ? p.expiringSoon : p.status === filter))
    && words.every((w) => `${p.name} ${p.category || ''}`.toLowerCase().includes(w)))
  const categories = [...new Set(active.map((p) => p.category || 'Other'))].sort()
  return json({ products: list, summary, categories })
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can add products.')
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the product as JSON.')
  const { values, errors } = productInput(body)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  const dup = await env.DB.prepare('SELECT id FROM products WHERE branch_id = 1 AND name = ? COLLATE NOCASE AND deleted_at IS NULL').bind(values.name).first()
  if (dup) return fail(409, 'A product with this name is already on the list.', { errors: { name: 'Already on the list. Search for it instead.' } })
  const cols = Object.keys(values)
  const row = await env.DB.prepare(`INSERT INTO products (${cols.join(', ')}, source, created_by) VALUES (${cols.map(() => '?').join(', ')}, 'inventory', ?) RETURNING *`)
    .bind(...cols.map((c) => values[c]), data.staff.name).first()
  await audit(env, data.staff.email, 'create', 'product', row.id, { name: row.name })
  return json({ product: productOut(row) }, 201)
}
