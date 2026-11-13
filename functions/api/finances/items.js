// GET /api/finances/items?q=&from=&to=&source=&page= -> owners and admins.
//   Invoice Items: every service and product billed on a visit or quick sale in the app, one row each.
//   (The old system's invoice items join here once their export is imported.)

import { json, fail, canManage } from '../../../lib/http.js'
import { listOf } from '../../../lib/finances.js'

const ROWS = `
  SELECT 'app' AS source, 'visit' AS kind, i.id, a.day, i.created_at AS at, '#' || substr(a.day, 1, 4) || 'A' || a.id AS invoice_no, a.id AS ref_id,
    o.id AS owner_id, o.full_name AS client, p.name AS pet, i.name AS item, i.detail, i.kind AS item_kind, i.qty, i.price_cents AS price
  FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id JOIN owners o ON o.id = a.owner_id JOIN pets p ON p.id = a.pet_id
  WHERE i.deleted_at IS NULL AND a.deleted_at IS NULL AND a.source <> 'legacy' AND (a.status = 'completed' OR a.payment_status = 'paid')
  UNION ALL
  SELECT 'app', 'sale', si.id, s.day, s.at, '#S' || s.id, s.id, o.id, COALESCE(o.full_name, s.customer), NULL, si.name, NULL, 'product', si.qty, si.price_cents
  FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN owners o ON o.id = s.owner_id WHERE s.voided_at IS NULL`

export async function onRequestGet({ env, request, data }) {
  if (!canManage(data.staff)) return fail(403, 'Transactions are for the clinic owners and admins.')
  const { rows, totals, page, size } = await listOf(env, new URL(request.url), ROWS, 'COALESCE(SUM(COALESCE(price, 0) * qty), 0) AS amount')
  return json({
    total: totals.n, amount: totals.amount / 100, page, size,
    rows: rows.map((r) => ({
      source: r.source, kind: r.kind, id: r.id, day: r.day, invoiceNo: r.invoice_no, refId: r.ref_id, ownerId: r.owner_id, client: r.client, pet: r.pet,
      item: r.item, detail: r.detail, itemKind: r.item_kind, qty: r.qty, price: r.price == null ? null : r.price / 100, amount: r.price == null ? null : (r.price * r.qty) / 100,
    })),
  })
}
