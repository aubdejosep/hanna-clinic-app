// GET /api/finances/payments?q=&from=&to=&source=&page= -> owners and admins.
//   Payments: every payment taken in the app (visits, quick sales, balances; voided ones marked) and the
//   payments imported from the old system.

import { json, fail, canManage } from '../../../lib/http.js'
import { listOf } from '../../../lib/finances.js'

const ROWS = `
  SELECT 'app' AS source, y.kind, y.id, y.day, y.at, COALESCE(i.invoice_no, CASE WHEN y.appointment_id THEN '#' || substr(a.day, 1, 4) || 'A' || a.id WHEN y.sale_id THEN '#S' || y.sale_id END) AS invoice_no,
    y.appointment_id, y.sale_id, COALESCE(o1.id, o2.id, o3.id) AS owner_id, COALESCE(o1.full_name, o2.full_name, o3.full_name, s.customer) AS client, p.name AS pet,
    y.amount_cents AS amount, y.method, y.reference, y.note, y.staff_name AS staff, y.voided_at, NULL AS amount_note
  FROM payments y LEFT JOIN appointments a ON a.id = y.appointment_id LEFT JOIN owners o1 ON o1.id = a.owner_id LEFT JOIN pets p ON p.id = a.pet_id
    LEFT JOIN sales s ON s.id = y.sale_id LEFT JOIN owners o2 ON o2.id = s.owner_id LEFT JOIN owners o3 ON o3.id = y.owner_id
    LEFT JOIN old_invoices i ON i.id = y.old_invoice_id
  UNION ALL
  SELECT 'old', 'old', op.id, op.day, COALESCE(op.day, ''), op.invoice_no, NULL, NULL, op.owner_id, op.customer_name, op.pet_name,
    op.amount_cents, op.method, op.reference, op.reason, op.creator, NULL, op.amount_note
  FROM old_payments op`

export async function onRequestGet({ env, request, data }) {
  if (!canManage(data.staff)) return fail(403, 'Transactions are for the clinic owners and admins.')
  const { rows, totals, page, size } = await listOf(env, new URL(request.url), ROWS, 'COALESCE(SUM(CASE WHEN voided_at IS NULL THEN amount END), 0) AS amount')
  return json({
    total: totals.n, amount: totals.amount / 100, page, size,
    rows: rows.map((r) => ({
      source: r.source, kind: r.kind, id: r.id, day: r.day, at: r.at, invoiceNo: r.invoice_no, appointmentId: r.appointment_id, ownerId: r.owner_id,
      client: r.client, pet: r.pet, amount: r.amount / 100, method: r.method, reference: r.reference, note: r.note, staff: r.staff,
      amountNote: r.amount_note, status: r.voided_at ? 'Void' : 'Paid',
    })),
  })
}
