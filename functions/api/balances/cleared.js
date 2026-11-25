// GET /api/balances/cleared -> the latest 100 payments against balances and clears (every staff member)

import { json } from '../../../lib/http.js'

export async function onRequestGet({ env }) {
  const [pays, clears] = await env.DB.batch([
    env.DB.prepare(`SELECT y.id, y.at, y.amount_cents, y.method, y.staff_name, y.appointment_id, y.old_invoice_id, y.cash_line_id, o.id AS owner_id, o.full_name, i.invoice_no, l.day AS ledger_day, l.book AS ledger_book, l.receipt_no, l.receipt_qr
      FROM payments y JOIN owners o ON o.id = y.owner_id LEFT JOIN old_invoices i ON i.id = y.old_invoice_id LEFT JOIN cash_lines l ON l.id = y.cash_line_id
      WHERE y.kind = 'balance' AND y.voided_at IS NULL AND o.deleted_at IS NULL ORDER BY y.at DESC LIMIT 100`),
    env.DB.prepare(`SELECT c.id, c.at, c.amount_cents, c.reason, c.staff_name, c.appointment_id, c.old_invoice_id, c.cash_line_id, o.id AS owner_id, o.full_name, i.invoice_no, l.day AS ledger_day, l.book AS ledger_book, l.receipt_no, l.receipt_qr
      FROM balance_clears c JOIN owners o ON o.id = c.owner_id LEFT JOIN old_invoices i ON i.id = c.old_invoice_id LEFT JOIN cash_lines l ON l.id = c.cash_line_id WHERE o.deleted_at IS NULL ORDER BY c.at DESC LIMIT 100`),
  ])
  const row = (kind) => (r) => ({ kind, id: `${kind}${r.id}`, at: r.at, amount: r.amount_cents / 100, method: r.method || null, reason: r.reason || null, by: r.staff_name,
    owner: { id: r.owner_id, name: r.full_name }, appointmentId: r.appointment_id, invoiceNo: r.invoice_no,
    cashLineId: r.cash_line_id || null, ledgerDay: r.ledger_day || null, ledgerBook: r.ledger_book || null,
    receiptLabel: r.receipt_no ? `OR ${r.receipt_no}` : r.receipt_qr ? `QR ${r.receipt_qr}` : null })
  const list = [...pays.results.map(row('payment')), ...clears.results.map(row('clear'))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100)
  return json({ cleared: list })
}
