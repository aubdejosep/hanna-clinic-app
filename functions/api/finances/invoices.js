// GET /api/finances/invoices?q=&from=&to=&source=&page= -> owners and admins.
//   Invoices: every visit checked out or paid in the app (its bill), every quick sale, and the invoices
//   imported from the old system. Paid, Part Paid, Unpaid or Void.

import { json, fail, canManage } from '../../../lib/http.js'
import { listOf } from '../../../lib/finances.js'

const ROWS = `
  SELECT 'app' AS source, 'visit' AS kind, a.id, a.day, COALESCE(a.paid_at, a.checked_out_at, a.day) AS at, '#' || substr(a.day, 1, 4) || 'A' || a.id AS invoice_no,
    o.id AS owner_id, o.full_name AS client, p.name AS pet,
    (SELECT COALESCE(SUM(COALESCE(i.price_cents, 0) * i.qty), 0) FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL) AS total,
    (SELECT COALESCE(SUM(y.amount_cents), 0) FROM payments y WHERE y.appointment_id = a.id AND y.voided_at IS NULL) AS paid,
    (SELECT COALESCE(SUM(y.owed_cents), 0) FROM payments y WHERE y.appointment_id = a.id AND y.voided_at IS NULL) AS owed,
    (SELECT y.method FROM payments y WHERE y.appointment_id = a.id AND y.voided_at IS NULL ORDER BY y.id LIMIT 1) AS method,
    (SELECT GROUP_CONCAT(s.first_name, ', ') FROM appointment_staff x JOIN staff s ON s.id = x.staff_id WHERE x.appointment_id = a.id) AS staff,
    NULL AS old_status, NULL AS voided
  FROM appointments a JOIN owners o ON o.id = a.owner_id JOIN pets p ON p.id = a.pet_id
  WHERE a.deleted_at IS NULL AND a.source <> 'legacy' AND (a.status = 'completed' OR a.payment_status = 'paid')
  UNION ALL
  SELECT 'app', 'sale', s.id, s.day, s.at, '#S' || s.id, o.id, COALESCE(o.full_name, s.customer), NULL, s.total_cents,
    (SELECT COALESCE(SUM(y.amount_cents), 0) FROM payments y WHERE y.sale_id = s.id AND y.voided_at IS NULL), 0,
    (SELECT y.method FROM payments y WHERE y.sale_id = s.id ORDER BY y.id LIMIT 1), s.staff_name, NULL, s.voided_at
  FROM sales s LEFT JOIN owners o ON o.id = s.owner_id WHERE s.deleted_at IS NULL
  UNION ALL
  SELECT 'old', 'invoice', i.id, i.day, COALESCE(i.day, ''), i.invoice_no, i.owner_id, i.customer_name, i.pet_name, i.amount_cents, i.paid_cents, 0,
    i.method, i.staff_names, i.status, NULL
  FROM old_invoices i`

export async function onRequestGet({ env, request, data }) {
  if (!canManage(data.staff)) return fail(403, 'Transactions are for the clinic owners and admins.')
  const { rows, totals, page, size } = await listOf(env, new URL(request.url), ROWS,
    "COALESCE(SUM(CASE WHEN voided IS NULL THEN total END), 0) AS billed, COALESCE(SUM(CASE WHEN voided IS NULL THEN paid END), 0) AS paid, COALESCE(SUM(CASE WHEN voided IS NULL AND total > paid AND (old_status IS NULL OR old_status = 'UNPAID') THEN total - paid END), 0) AS unpaid")
  return json({
    total: totals.n, billed: totals.billed / 100, paid: totals.paid / 100, unpaid: totals.unpaid / 100, page, size,
    rows: rows.map((r) => ({
      source: r.source, kind: r.kind, id: r.id, day: r.day, invoiceNo: r.invoice_no, ownerId: r.owner_id, client: r.client, pet: r.pet,
      total: r.total / 100, paid: r.paid / 100, owed: r.owed / 100, method: r.method, staff: r.staff,
      status: r.voided ? 'Void' : r.source === 'old' ? (r.old_status === 'PAID' ? 'Paid' : r.total ? 'Unpaid' : 'No Charge')
        : r.paid >= r.total ? (r.total ? 'Paid' : 'No Charge') : r.paid > 0 ? 'Part Paid' : 'Unpaid',
    })),
  })
}
