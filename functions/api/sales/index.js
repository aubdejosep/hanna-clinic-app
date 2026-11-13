// GET  /api/sales?day= -> over-the-counter sales of a day (default today)
// POST /api/sales {items: [{productId, qty}], customer, method, amount, reference, note}
//   -> Sell Items: a sale with no pet visit. Paid and handed over, so the stock comes off at once.

import { json, fail, readJson, clean, isoDay, manilaToday, audit } from '../../../lib/http.js'
import { METHODS, applyMovements } from '../../../lib/stock.js'
import { toCents } from '../../../lib/services.js'
import { qtyOf } from '../../../lib/inventory.js'

export async function loadSales(env, where, binds) {
  const { results } = await env.DB.prepare(`SELECT s.*, (SELECT GROUP_CONCAT(i.name || ' × ' || printf('%g', i.qty), ', ') FROM sale_items i WHERE i.sale_id = s.id) AS items_text,
      (SELECT method FROM payments p WHERE p.sale_id = s.id ORDER BY p.id DESC LIMIT 1) AS method
    FROM sales s WHERE s.deleted_at IS NULL AND (${where}) ORDER BY s.at DESC LIMIT 200`).bind(...binds).all()
  return results.map((s) => ({ id: s.id, at: s.at, day: s.day, customer: s.customer, total: s.total_cents / 100, method: s.method, by: s.staff_name,
    items: s.items_text || '', voidedAt: s.voided_at, voidedBy: s.voided_by, voidReason: s.void_reason }))
}

export async function onRequestGet({ env, request }) {
  const day = isoDay(new URL(request.url).searchParams.get('day')) || manilaToday()
  return json({ day, sales: await loadSales(env, 's.day = ?', [day]) })
}

export async function onRequestPost({ request, env, data }) {
  const body = (await readJson(request)) || {}
  const wanted = (Array.isArray(body.items) ? body.items : []).slice(0, 30)
  const items = []
  for (const it of wanted) {
    const p = await env.DB.prepare('SELECT id, name, price_cents FROM products WHERE id = ? AND deleted_at IS NULL').bind(Number(it?.productId)).first()
    const qty = qtyOf(it?.qty)
    if (p && qty > 0) items.push({ ...p, qty })
  }
  if (!items.length) return fail(400, 'Add at least one item.')
  if (!METHODS[body.method]) return fail(400, 'Choose how they paid.', { errors: { method: 'Choose how they paid.' } })
  const due = Math.round(items.reduce((n, i) => n + (i.price_cents || 0) * i.qty, 0))
  const amount = body.method === 'no_charge' ? 0 : body.amount === undefined || body.amount === '' ? due : toCents(body.amount)
  if (amount === null) return fail(400, 'Enter the amount paid.', { errors: { amount: 'Enter the amount paid, e.g. 350.' } })
  const note = clean(body.note, 200) || null
  if (amount !== due && !note) return fail(400, 'The amount differs from the total. Say why, e.g. a discount.', { errors: { note: 'Say why the amount differs.' } })
  const now = new Date().toISOString()
  const day = manilaToday()
  const sale = await env.DB.prepare('INSERT INTO sales (at, day, customer, total_cents, staff_id, staff_name) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(now, day, clean(body.customer, 80) || null, amount, data.staff.id, data.staff.name).first()
  await applyMovements(env, items.map((i) => ({ productId: i.id, qty: -i.qty, kind: 'sale', saleId: sale.id, staff: data.staff })), [
    ...items.map((i) => env.DB.prepare('INSERT INTO sale_items (sale_id, product_id, name, qty, price_cents) VALUES (?, ?, ?, ?, ?)').bind(sale.id, i.id, i.name, i.qty, i.price_cents)),
    env.DB.prepare(`INSERT INTO payments (sale_id, kind, at, day, due_cents, amount_cents, method, reference, note, staff_id, staff_name) VALUES (?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(sale.id, now, day, due, amount, body.method, clean(body.reference, 60) || null, note, data.staff.id, data.staff.name),
  ])
  await audit(env, data.staff.email, 'sale', 'sale', sale.id, { due, amount, method: body.method, items: items.map((i) => [i.name, i.qty]) })
  return json({ sale: (await loadSales(env, 's.id = ?', [sale.id]))[0] }, 201)
}
