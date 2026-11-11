// GET   /api/inventory/:id -> the product, its batches, its last 100 movements and the services that use it
// PATCH /api/inventory/:id {name, category, unit, packName, packSize, price, cost, reorderLevel, active} -> owners
// Stock itself never changes here: use Receive, Adjust, a visit, a sale or a stock count.

import { json, fail, readJson, canManage, audit } from '../../../lib/http.js'
import { productOut } from '../../../lib/stock.js'
import { productInput } from '../../../lib/inventory.js'
import { setClause } from '../../../lib/clients.js'

export async function loadProduct(env, id) {
  const [p, batches, moves, uses] = await env.DB.batch([
    env.DB.prepare(`SELECT p.*, (SELECT MIN(b.expiry) FROM stock_batches b WHERE b.product_id = p.id AND b.remaining > 0 AND b.expiry IS NOT NULL) AS nearest_expiry
      FROM products p WHERE p.id = ? AND p.deleted_at IS NULL`).bind(id),
    env.DB.prepare('SELECT * FROM stock_batches WHERE product_id = ? AND remaining > 0 ORDER BY expiry IS NULL, expiry, received_on').bind(id),
    env.DB.prepare(`SELECT m.*, pt.name AS pet_name FROM stock_movements m LEFT JOIN appointments a ON a.id = m.appointment_id LEFT JOIN pets pt ON pt.id = a.pet_id
      WHERE m.product_id = ? ORDER BY m.at DESC, m.id DESC LIMIT 100`).bind(id),
    env.DB.prepare(`SELECT s.name AS service, v.name AS variation, l.qty FROM service_stock l JOIN services s ON s.id = l.service_id
      LEFT JOIN service_variations v ON v.id = l.variation_id WHERE l.product_id = ? AND l.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.name, v.sort`).bind(id),
  ])
  if (!p.results[0]) return null
  return {
    ...productOut(p.results[0]),
    batches: batches.results.map((b) => ({ id: b.id, batchNo: b.batch_no, expiry: b.expiry, received: b.received_qty, remaining: b.remaining, receivedOn: b.received_on, supplier: b.supplier })),
    movements: moves.results.map(moveOut),
    usedBy: uses.results.map((u) => ({ service: u.service, variation: u.variation, qty: u.qty })),
  }
}

export function moveOut(m) {
  return {
    id: m.id, at: m.at, kind: m.kind, qty: m.qty, balance: m.balance, reason: m.reason, appointmentId: m.appointment_id, saleId: m.sale_id,
    countId: m.count_id, by: m.staff_name, petName: m.pet_name || null, product: m.product_name ? { id: m.product_id, name: m.product_name, unit: m.unit } : undefined,
    unitCost: m.unit_cost_cents == null ? null : m.unit_cost_cents / 100,
  }
}

export async function onRequestGet({ env, params }) {
  const product = await loadProduct(env, Number(params.id))
  return product ? json({ product }) : fail(404, 'This product was not found.')
}

export async function onRequestPatch({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change product details.')
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the changes as JSON.')
  const { values, errors } = productInput(body, true)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  if (values.name) {
    const dup = await env.DB.prepare('SELECT id FROM products WHERE branch_id = 1 AND name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?').bind(values.name, id).first()
    if (dup) return fail(409, 'Another product already has this name.', { errors: { name: 'Another product already has this name.' } })
  }
  const before = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!before) return fail(404, 'This product was not found.')
  const { sql, binds } = setClause({ ...values, updated_at: new Date().toISOString() })
  await env.DB.prepare(`UPDATE products SET ${sql} WHERE id = ?`).bind(...binds, id).run()
  const changed = Object.fromEntries(Object.keys(values).filter((k) => before[k] !== values[k]).map((k) => [k, [before[k], values[k]]]))
  await audit(env, data.staff.email, 'update', 'product', id, changed)
  return json({ product: await loadProduct(env, id) })
}
