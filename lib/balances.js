// Balances: what clients still owe (Finances ▸ Balances, the owner page, Notifications).
//
// Three kinds of item, each with what's left to pay:
//   unpaid   a visit checked out without a payment (paid through Take Payment on the visit)
//   owed     a visit paid in part, the rest marked as owed at Take Payment (payments.owed_cents)
//   invoice  an unpaid invoice imported from the old system
// Payments against owed/invoice items are payments rows with kind 'balance'; owners can clear an
// item with a reason (balance_clears). Reads use partial indexes, so the whole list stays cheap.

const left = (n) => Math.max(0, Math.round(n))

// -> [{ type, id, ownerId, petId, petName, day, label, total, paid, left }] with left > 0
export async function openItems(env, { ownerIds } = {}) {
  const only = (col) => (ownerIds ? ` AND ${col} IN (${ownerIds.map(Number).join(',') || 0})` : '')
  const [unpaid, owed, invoices, later, clears] = await env.DB.batch([
    env.DB.prepare(`SELECT a.id, a.owner_id, a.pet_id, a.day, p.name AS pet_name,
        (SELECT COALESCE(SUM(COALESCE(i.price_cents, 0) * i.qty), 0) FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL) AS due
      FROM appointments a INDEXED BY idx_appointments_unpaid JOIN pets p ON p.id = a.pet_id
      WHERE a.status = 'completed' AND a.payment_status = 'unpaid' AND a.deleted_at IS NULL AND a.source <> 'legacy'${only('a.owner_id')}`),
    env.DB.prepare(`SELECT y.appointment_id AS id, a.owner_id, a.pet_id, a.day, p.name AS pet_name, SUM(y.due_cents) AS due, SUM(y.owed_cents) AS owed
      FROM payments y INDEXED BY idx_payments_owed JOIN appointments a ON a.id = y.appointment_id JOIN pets p ON p.id = a.pet_id
      WHERE y.owed_cents > 0 AND y.voided_at IS NULL AND a.deleted_at IS NULL${only('a.owner_id')} GROUP BY y.appointment_id`),
    env.DB.prepare(`SELECT id, owner_id, pet_id, day, pet_name, customer_name, invoice_no, amount_cents, paid_cents, refunded_cents FROM old_invoices
      WHERE status = 'UNPAID' AND amount_cents - paid_cents - refunded_cents > 0 AND owner_id IS NOT NULL${only('owner_id')}`),
    env.DB.prepare(`SELECT appointment_id, old_invoice_id, SUM(amount_cents) AS n, MAX(at) AS last FROM payments INDEXED BY idx_payments_balance
      WHERE kind = 'balance' AND voided_at IS NULL${only('owner_id')} GROUP BY appointment_id, old_invoice_id`),
    env.DB.prepare(`SELECT appointment_id, old_invoice_id, SUM(amount_cents) AS n FROM balance_clears WHERE 1 = 1${only('owner_id')} GROUP BY appointment_id, old_invoice_id`),
  ])
  const sumFor = (rows, field, id) => rows.results.filter((r) => r[field] === id).reduce((s, r) => s + r.n, 0)
  const out = []
  for (const r of unpaid.results) {
    const rest = left(r.due - sumFor(clears, 'appointment_id', r.id))
    if (rest > 0) out.push({ type: 'unpaid', id: r.id, ownerId: r.owner_id, petId: r.pet_id, petName: r.pet_name, day: r.day, label: 'Visit checked out without a payment', total: r.due / 100, paid: 0, left: rest / 100 })
  }
  for (const r of owed.results) {
    const paidLater = sumFor(later, 'appointment_id', r.id)
    const rest = left(r.owed - paidLater - sumFor(clears, 'appointment_id', r.id))
    if (rest > 0) out.push({ type: 'owed', id: r.id, ownerId: r.owner_id, petId: r.pet_id, petName: r.pet_name, day: r.day, label: 'Visit paid in part', total: r.due / 100, paid: (r.due - r.owed + paidLater) / 100, left: rest / 100 })
  }
  for (const r of invoices.results) {
    const paidLater = sumFor(later, 'old_invoice_id', r.id)
    const rest = left(r.amount_cents - r.paid_cents - r.refunded_cents - paidLater - sumFor(clears, 'old_invoice_id', r.id))
    if (rest > 0) out.push({ type: 'invoice', id: r.id, ownerId: r.owner_id, petId: r.pet_id, petName: r.pet_name, day: r.day, label: `Old system invoice ${r.invoice_no}`, total: r.amount_cents / 100, paid: (r.paid_cents + paidLater) / 100, left: rest / 100 })
  }
  return out.sort((a, b) => String(a.day || '').localeCompare(String(b.day || '')))
}

// Item -> its owner and what's left (for paying or clearing one), or null when it's settled.
export async function findItem(env, type, id) {
  const items = await openItems(env)
  return items.find((x) => x.type === type && x.id === Number(id)) || null
}
