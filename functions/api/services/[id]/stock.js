// GET /api/services/:id/stock -> what the service and each of its sizes use from stock
// PUT /api/services/:id/stock {links: [{variationId|null, productId, qty}]} -> replaces them (owners).
//   variationId null = the service itself and every size without links of its own.
// Staff never see this: a checked-out, paid visit takes these off stock by itself.

import { json, fail, readJson, canManage, audit } from '../../../../lib/http.js'
import { qtyOf } from '../../../../lib/inventory.js'

async function load(env, id) {
  const { results } = await env.DB.prepare(`SELECT l.variation_id, l.product_id, l.qty, p.name, p.unit FROM service_stock l JOIN products p ON p.id = l.product_id
    WHERE l.service_id = ? AND l.deleted_at IS NULL ORDER BY l.id`).bind(id).all()
  return results.map((r) => ({ variationId: r.variation_id, productId: r.product_id, qty: r.qty, name: r.name, unit: r.unit }))
}

export async function onRequestGet({ env, params }) {
  return json({ links: await load(env, Number(params.id)) })
}

export async function onRequestPut({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change what a service uses.')
  const id = Number(params.id)
  const s = await env.DB.prepare('SELECT id FROM services WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!s) return fail(404, 'This service was not found.')
  const body = (await readJson(request)) || {}
  const { results: vars } = await env.DB.prepare('SELECT id FROM service_variations WHERE service_id = ?').bind(id).all()
  const varIds = new Set(vars.map((v) => v.id))
  const seen = new Set()
  const links = []
  for (const l of (Array.isArray(body.links) ? body.links : []).slice(0, 100)) {
    const variationId = l.variationId ? Number(l.variationId) : null
    const productId = Number(l.productId)
    const qty = qtyOf(l.qty)
    if (variationId && !varIds.has(variationId)) continue
    if (!productId || !(qty > 0)) continue
    const key = `${variationId || 0}:${productId}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ variationId, productId, qty })
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE service_stock SET deleted_at = ?, deleted_by = ? WHERE service_id = ? AND deleted_at IS NULL').bind(new Date().toISOString(), data.staff.name, id),
    ...links.map((l) => env.DB.prepare('INSERT INTO service_stock (service_id, variation_id, product_id, qty, created_by) VALUES (?, ?, ?, ?, ?)').bind(id, l.variationId, l.productId, l.qty, data.staff.name)),
  ])
  await audit(env, data.staff.email, 'service_stock', 'service', id, { links })
  return json({ links: await load(env, id) })
}
