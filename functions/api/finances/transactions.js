// GET /api/finances/transactions?from=&to=&q=&source=all|app|old&page=&size= -> owners and admins.
//   Every payment taken in the app (visits, quick sales, balance payments; voided ones marked) and every
//   invoice imported from the old system, newest first, with totals for the filter.

import { json, fail, canManage } from '../../../lib/http.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const ROWS = `
  SELECT 'app' AS source, y.id, y.day, y.at, y.kind, y.amount_cents AS paid, y.due_cents AS total, y.owed_cents AS owed, y.method, y.staff_name AS staff,
    y.voided_at, y.appointment_id, y.sale_id, y.old_invoice_id, COALESCE(o1.id, o2.id, o3.id) AS owner_id,
    COALESCE(o1.full_name, o2.full_name, o3.full_name, s.customer) AS client, p.name AS pet, i.invoice_no AS invoice_no, NULL AS old_status
  FROM payments y LEFT JOIN appointments a ON a.id = y.appointment_id LEFT JOIN owners o1 ON o1.id = a.owner_id LEFT JOIN pets p ON p.id = a.pet_id
    LEFT JOIN sales s ON s.id = y.sale_id LEFT JOIN owners o2 ON o2.id = s.owner_id LEFT JOIN owners o3 ON o3.id = y.owner_id
    LEFT JOIN old_invoices i ON i.id = y.old_invoice_id
  UNION ALL
  SELECT 'old', i.id, i.day, COALESCE(i.day, ''), 'invoice', i.paid_cents, i.amount_cents, 0, i.method, i.staff_names, NULL, NULL, NULL, NULL, i.owner_id,
    i.customer_name, i.pet_name, i.invoice_no, i.status
  FROM old_invoices i`

export async function onRequestGet({ env, request, data }) {
  if (!canManage(data.staff)) return fail(403, 'Transactions are for the clinic owners and admins.')
  const u = new URL(request.url).searchParams
  const from = DAY.test(u.get('from') || '') ? u.get('from') : null
  const to = DAY.test(u.get('to') || '') ? u.get('to') : null
  const q = (u.get('q') || '').trim().slice(0, 60)
  const source = ['app', 'old'].includes(u.get('source')) ? u.get('source') : null
  const size = Math.min(100, Math.max(10, Number(u.get('size')) || 25))
  const page = Math.max(1, Number(u.get('page')) || 1)
  const where = []
  const binds = []
  if (from) { where.push('day >= ?'); binds.push(from) }
  if (to) { where.push('day <= ?'); binds.push(to) }
  if (source) { where.push('source = ?'); binds.push(source) }
  if (q) { where.push('(client LIKE ? OR pet LIKE ? OR invoice_no LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows, sums] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM (${ROWS}) ${w} ORDER BY day IS NULL, day DESC, at DESC, id DESC LIMIT ? OFFSET ?`).bind(...binds, size, (page - 1) * size),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN voided_at IS NULL THEN paid END), 0) AS paid,
        COALESCE(SUM(CASE WHEN source = 'old' AND old_status = 'UNPAID' THEN total - paid END), 0) AS old_unpaid FROM (${ROWS}) ${w}`).bind(...binds),
  ])
  const s = sums.results[0]
  return json({
    total: s.n, paid: s.paid / 100, oldUnpaid: s.old_unpaid / 100, page, size,
    rows: rows.results.map((r) => ({
      source: r.source, id: r.id, day: r.day, at: r.at, kind: r.kind, client: r.client, pet: r.pet, ownerId: r.owner_id,
      invoiceNo: r.invoice_no, total: r.total / 100, paid: r.paid / 100, owed: r.owed / 100, method: r.method, staff: r.staff,
      appointmentId: r.appointment_id, saleId: r.sale_id,
      status: r.source === 'old' ? (r.old_status === 'PAID' ? 'Paid' : 'Unpaid') : r.voided_at ? 'Void' : r.kind === 'balance' ? 'Balance Payment' : r.owed > 0 ? 'Part Paid' : 'Paid',
    })),
  })
}
