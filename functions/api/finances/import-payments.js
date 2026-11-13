// POST /api/finances/import-payments {rows: [...]} -> owners and admins: the old system's payment
//   transactions export. Matched to the imported invoice by number (import invoices first) and to an
//   owner by name. Re-importing the same export updates the same rows.
// The export rounds big amounts ("₱23.7K"): those are worked out from the invoice (what it says was paid,
// less its other payments) and marked in amount_note.
// A row: {invoiceNo, txnNo, reference, customer, pet, method, amount, date, time, reason, creator}

import { json, fail, readJson, clean, canManage, audit } from '../../../lib/http.js'
import { oldDay } from './import.js'

const blank = (s) => { const v = clean(String(s ?? ''), 120); return !v || v === '—' || v === '-' ? null : v }
function money(s) { // "₱1,800.00" -> 180000; "₱23.7K" -> {approx: 2370000}
  const t = String(s ?? '').replace(/[₱,\s]/g, '')
  const k = t.match(/^(\d+(?:\.\d+)?)K$/i)
  if (k) return { cents: Math.round(Number(k[1]) * 100000), approx: true }
  const n = Number(t)
  return Number.isFinite(n) ? { cents: Math.round(n * 100), approx: false } : null
}
const OWNER = `(SELECT CASE WHEN COUNT(*) = 1 THEN MAX(id) END FROM owners WHERE deleted_at IS NULL AND lower(trim(full_name)) = lower(trim(?)))`

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can import transactions.')
  const rows = (await readJson(request))?.rows
  if (!Array.isArray(rows) || !rows.length) return fail(400, 'The file has no payments in it.')
  if (rows.length > 5000) return fail(400, 'Import up to 5,000 payments at a time.')
  const nos = [...new Set(rows.map((r) => blank(r.invoiceNo)).filter(Boolean))]
  const inv = {}
  for (let i = 0; i < nos.length; i += 90) {
    const part = nos.slice(i, i + 90)
    const { results } = await env.DB.prepare(`SELECT id, invoice_no, paid_cents FROM old_invoices WHERE invoice_no IN (${part.map(() => '?').join(',')})`).bind(...part).all()
    for (const r of results) inv[r.invoice_no] = r
  }
  const parsed = rows.map((r) => ({ r, no: blank(r.invoiceNo), m: money(r.amount), day: oldDay(r.date) }))
  const seen = {}
  const now = new Date().toISOString()
  let approx = 0
  let worked = 0
  const stmts = []
  for (const x of parsed) {
    if (!x.m) continue
    let cents = x.m.cents
    let note = null
    if (x.m.approx) {
      approx += 1
      const invRow = inv[x.no]
      const others = parsed.filter((y) => y !== x && y.no === x.no && y.m && !y.m.approx).reduce((s, y) => s + y.m.cents, 0)
      if (invRow && invRow.paid_cents - others > 0) {
        cents = invRow.paid_cents - others
        note = `Shown as ${String(x.r.amount).trim()} in the export; worked out from the invoice`
        worked += 1
      } else note = `Shown as ${String(x.r.amount).trim()} in the export (rounded)`
    }
    const base = `${x.no || ''}|${x.day || x.r.date || ''}|${String(x.r.amount).trim()}`
    seen[base] = (seen[base] || 0) + 1
    const key = `${base}|${seen[base]}`
    const customer = blank(x.r.customer)
    stmts.push(env.DB.prepare(`INSERT INTO old_payments (import_key, invoice_no, old_invoice_id, txn_no, reference, customer_name, pet_name, owner_id, method, amount_cents, amount_note, day, time, reason, creator, imported_at, imported_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${OWNER}, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (import_key) DO UPDATE SET old_invoice_id = excluded.old_invoice_id, txn_no = excluded.txn_no, reference = excluded.reference, customer_name = excluded.customer_name,
        pet_name = excluded.pet_name, owner_id = excluded.owner_id, method = excluded.method, amount_cents = excluded.amount_cents, amount_note = excluded.amount_note,
        day = excluded.day, time = excluded.time, reason = excluded.reason, creator = excluded.creator, imported_at = excluded.imported_at, imported_by = excluded.imported_by`)
      .bind(key, x.no, inv[x.no]?.id ?? null, blank(x.r.txnNo), blank(x.r.reference), customer, blank(x.r.pet), customer || '', blank(x.r.method), cents, note,
        x.day, blank(x.r.time), blank(x.r.reason), blank(x.r.creator), now, data.staff.name))
  }
  if (!stmts.length) return fail(400, 'No payments were found. Check that this is the old system’s payment transactions export.')
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50))
  const res = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(old_invoice_id IS NOT NULL) AS linked, SUM(amount_cents) AS cents FROM old_payments WHERE imported_at = ?').bind(now).first()
  await audit(env, data.staff.email, 'import', 'old_payments', null, { rows: stmts.length })
  return json({ imported: res.n, linked: res.linked || 0, total: (res.cents || 0) / 100, rounded: approx, workedOut: worked })
}
