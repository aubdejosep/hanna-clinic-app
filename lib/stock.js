// Stock: every change is a row in stock_movements, and products.on_hand is kept equal to their sum
// in the same database batch. Nothing here edits or deletes a movement; mistakes get a new one.
//
// A visit's stock (its medicines and products, plus what its services use, from service_stock)
// comes off only once the visit is both paid and checked out. syncVisitStock() makes the visit's
// movements match that rule, so every step calls it: check out, payment, items added or removed,
// undo, and a voided payment.

export const UNITS = ['tablet', 'capsule', 'ml', 'vial', 'dose', 'piece', 'sachet', 'tube', 'bottle', 'bar', 'pack', 'box']
export const ADJUST_REASONS = ['Expired', 'Damaged', 'Used in Clinic', 'Lost or Missing', 'Found', 'Returned to Supplier', 'Correction']
export const METHODS = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank: 'Bank Transfer', no_charge: 'No Charge' }

const round = (n) => Math.round(n * 1000) / 1000

// Two statements per movement: the movement (balance worked out from on_hand as it is then) and
// the new on_hand. Run inside one env.DB.batch so they can't drift apart.
export function movementStatements(env, m) {
  const at = m.at || new Date().toISOString()
  const qty = round(m.qty)
  return [
    env.DB.prepare(`INSERT INTO stock_movements (product_id, at, kind, qty, balance, reason, appointment_id, item_id, sale_id, count_id, batch_id, unit_cost_cents, staff_id, staff_name)
      SELECT id, ?, ?, ?, ROUND(on_hand + ?, 3), ?, ?, ?, ?, ?, ?, COALESCE(?, cost_cents), ?, ? FROM products WHERE id = ?`)
      .bind(at, m.kind, qty, qty, m.reason || null, m.appointmentId || null, m.itemId || null, m.saleId || null, m.countId || null, m.batchId || null,
        m.unitCostCents ?? null, m.staff?.id || null, m.staff?.name || null, m.productId),
    env.DB.prepare('UPDATE products SET on_hand = ROUND(on_hand + ?, 3) WHERE id = ?').bind(qty, m.productId),
  ]
}

// Batches (for expiry dates): stock out comes from the earliest expiry first; stock back in goes to
// the latest delivery. -> statements
async function batchStatements(env, deltas) {
  const ids = Object.keys(deltas).map(Number).filter((id) => deltas[id])
  if (!ids.length) return []
  const { results } = await env.DB.prepare(`SELECT id, product_id, remaining, received_qty FROM stock_batches WHERE product_id IN (${ids.join(',')})
    ORDER BY expiry IS NULL, expiry, received_on, id`).all()
  const out = []
  for (const pid of ids) {
    const mine = results.filter((b) => b.product_id === pid)
    let d = deltas[pid]
    if (d < 0) {
      for (const b of mine) {
        if (d >= 0) break
        if (b.remaining <= 0) continue
        const take = Math.min(b.remaining, -d)
        out.push(env.DB.prepare('UPDATE stock_batches SET remaining = ROUND(remaining - ?, 3) WHERE id = ?').bind(take, b.id))
        d += take
      }
    } else {
      const last = mine[mine.length - 1]
      if (last) out.push(env.DB.prepare('UPDATE stock_batches SET remaining = ROUND(remaining + ?, 3) WHERE id = ?').bind(d, last.id))
    }
  }
  return out
}

// Applies movements (and any extra statements) in one batch.
export async function applyMovements(env, list, extra = [], { batches = true } = {}) {
  const moves = list.filter((m) => m.productId && round(m.qty) !== 0)
  const deltas = {}
  for (const m of moves) deltas[m.productId] = round((deltas[m.productId] || 0) + m.qty)
  const statements = [...moves.flatMap((m) => movementStatements(env, m)), ...(batches ? await batchStatements(env, deltas) : []), ...extra]
  for (let i = 0; i < statements.length; i += 200) await env.DB.batch(statements.slice(i, i + 200))
  return moves.length
}

// What a visit uses from stock: its medicines and products, and what its services are linked to
// (a size's own links, else the service's). -> {productId: qty}
export async function visitUsage(env, appointmentId) {
  const { results: items } = await env.DB.prepare(`SELECT service_id, variation_id, product_id, qty FROM appointment_items
    WHERE appointment_id = ? AND deleted_at IS NULL`).bind(appointmentId).all()
  const serviceIds = [...new Set(items.map((i) => i.service_id).filter(Boolean))]
  const links = serviceIds.length ? (await env.DB.prepare(`SELECT service_id, variation_id, product_id, qty FROM service_stock
    WHERE service_id IN (${serviceIds.join(',')}) AND deleted_at IS NULL`).all()).results : []
  const use = {}
  const add = (pid, q) => { use[pid] = round((use[pid] || 0) + q) }
  for (const it of items) {
    if (it.product_id) add(it.product_id, it.qty || 1)
    if (!it.service_id) continue
    const own = links.filter((l) => l.service_id === it.service_id && it.variation_id && l.variation_id === it.variation_id)
    const list = own.length ? own : links.filter((l) => l.service_id === it.service_id && l.variation_id == null)
    for (const l of list) add(l.product_id, l.qty * (it.qty || 1))
  }
  return use
}

// Makes the visit's stock movements match the rule: taken off when paid and checked out, otherwise
// none. Safe to call any number of times. -> number of movements written
export async function syncVisitStock(env, appointmentId, staff) {
  const a = await env.DB.prepare('SELECT status, payment_status, stock_deducted_at FROM appointments WHERE id = ?').bind(appointmentId).first()
  if (!a) return 0
  const due = a.status === 'completed' && a.payment_status === 'paid'
  if (due && !a.stock_deducted_at) await env.DB.prepare('UPDATE appointments SET stock_deducted_at = ? WHERE id = ?').bind(new Date().toISOString(), appointmentId).run()
  if (!due && a.stock_deducted_at) await env.DB.prepare('UPDATE appointments SET stock_deducted_at = NULL WHERE id = ?').bind(appointmentId).run()
  const target = due ? await visitUsage(env, appointmentId) : {}
  const { results: done } = await env.DB.prepare('SELECT product_id, SUM(qty) AS q FROM stock_movements WHERE appointment_id = ? GROUP BY product_id').bind(appointmentId).all()
  const taken = Object.fromEntries(done.map((r) => [r.product_id, round(-r.q)]))
  const moves = []
  for (const pid of new Set([...Object.keys(target), ...Object.keys(taken)].map(Number))) {
    const diff = round((target[pid] || 0) - (taken[pid] || 0)) // > 0: more to take off
    if (!diff) continue
    moves.push({ productId: pid, qty: -diff, kind: diff > 0 ? 'visit' : 'reversal', reason: diff > 0 ? null : due ? 'Removed from the visit' : 'Visit reopened or payment voided', appointmentId, staff })
  }
  return applyMovements(env, moves)
}

// The visit's total from the price list (services at their price, products at price × quantity).
export async function visitDue(env, appointmentId) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(COALESCE(price_cents, 0) * qty), 0) AS due FROM appointment_items WHERE appointment_id = ? AND deleted_at IS NULL').bind(appointmentId).first()
  return Math.round(row.due)
}

export function productOut(p) {
  return {
    id: p.id, name: p.name, category: p.category, unit: p.unit, packName: p.pack_name, packSize: p.pack_size,
    price: p.price_cents == null ? null : p.price_cents / 100, cost: p.cost_cents == null ? null : p.cost_cents / 100,
    reorderLevel: p.reorder_level, onHand: p.on_hand, countedAt: p.counted_at, active: !!p.active, source: p.source,
    nearestExpiry: p.nearest_expiry ?? null,
  }
}
