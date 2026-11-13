// POST /api/finances/import {rows: [...]} -> owners and admins: invoices exported from the old system
//   (Finances ▸ Transactions ▸ Import from Old System). Each row is matched to an owner (and pet) by name
//   when exactly one fits. Re-importing the same export updates the rows by invoice number.
// A row: {invoiceNo, date: "Nov. 10, 2026", customer, pet, status: PAID|UNPAID, paid, amount, refunded, method, staff}

import { json, fail, readJson, clean, canManage, audit } from '../../../lib/http.js'
import { toCents } from '../../../lib/services.js'

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
export function oldDay(s) { // "Nov. 10, 2026" -> "2026-11-10"; the export's "Jan. 1, 1970" means no date
  const m = String(s || '').trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})$/)
  if (!m) return null
  const mo = MONTHS[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3)]
  const y = Number(m[3])
  if (!mo || y < 2000) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
}
const blank = (s) => { const v = clean(String(s ?? ''), 120); return !v || v === '—' || v === '-' ? null : v }
const money = (s) => toCents(String(s ?? '').replace(/[^\d.]/g, '') || '0') ?? 0

const OWNER = `(SELECT CASE WHEN COUNT(*) = 1 THEN MAX(id) END FROM owners WHERE deleted_at IS NULL AND lower(trim(full_name)) = lower(trim(?1)))`

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can import transactions.')
  const rows = (await readJson(request))?.rows
  if (!Array.isArray(rows) || !rows.length) return fail(400, 'The file has no invoices in it.')
  if (rows.length > 5000) return fail(400, 'Import up to 5,000 invoices at a time.')
  const now = new Date().toISOString()
  let badDates = 0
  const stmts = []
  for (const r of rows) {
    const no = blank(r.invoiceNo)
    if (!no) continue
    const day = oldDay(r.date)
    if (!day) badDates += 1
    const customer = blank(r.customer)
    const pet = blank(r.pet)
    const status = String(r.status || '').trim().toUpperCase() === 'PAID' ? 'PAID' : 'UNPAID'
    stmts.push(env.DB.prepare(`INSERT INTO old_invoices (invoice_no, day, customer_name, pet_name, owner_id, pet_id, status, amount_cents, paid_cents, refunded_cents, method, staff_names, imported_at, imported_by)
      VALUES (?2, ?3, ?1, ?4, ${OWNER},
        (SELECT CASE WHEN COUNT(*) = 1 THEN MAX(id) END FROM pets WHERE deleted_at IS NULL AND owner_id = ${OWNER} AND lower(trim(name)) = lower(trim(?4))),
        ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      ON CONFLICT (invoice_no) DO UPDATE SET day = excluded.day, customer_name = excluded.customer_name, pet_name = excluded.pet_name, owner_id = excluded.owner_id,
        pet_id = excluded.pet_id, status = excluded.status, amount_cents = excluded.amount_cents, paid_cents = excluded.paid_cents, refunded_cents = excluded.refunded_cents,
        method = excluded.method, staff_names = excluded.staff_names, imported_at = excluded.imported_at, imported_by = excluded.imported_by`)
      .bind(customer || '', no, day, pet, status, money(r.amount), money(r.paid), money(r.refunded), blank(r.method), blank(r.staff), now, data.staff.name))
  }
  if (!stmts.length) return fail(400, 'No invoice numbers were found. Check that this is the old system’s invoice export.')
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50))
  const res = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(owner_id IS NOT NULL) AS matched, SUM(status = 'UNPAID' AND amount_cents - paid_cents - refunded_cents > 0) AS unpaid
    FROM old_invoices WHERE imported_at = ?`).bind(now).first()
  await audit(env, data.staff.email, 'import', 'old_invoices', null, { rows: stmts.length })
  return json({ imported: res.n, matched: res.matched || 0, unmatched: res.n - (res.matched || 0), unpaid: res.unpaid || 0, badDates })
}
