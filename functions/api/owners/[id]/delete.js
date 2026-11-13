// Delete Owner and All Records (owners and admins only), e.g. a test client.
// GET  /api/owners/:id/delete -> what would go: pets, visits, payments, quick sales, medical records
// POST /api/owners/:id/delete {confirm: "<the owner's name>"} -> does it
//
// Everything is marked deleted (deleted_at / deleted_by), never erased, so it leaves every list, search,
// total and report: the owner, their pets and tags, visits and their items, medical records, payments
// (also voided) and quick sales. Stock taken off by their paid visits and sales goes back on the shelf.

import { json, fail, readJson, canManage, audit } from '../../../../lib/http.js'
import { applyMovements, syncVisitStock } from '../../../../lib/stock.js'

async function scope(env, id) {
  const owner = await env.DB.prepare('SELECT id, full_name, customer_no FROM owners WHERE id = ?').bind(id).first()
  if (!owner) return null
  const [pets, appts, sales] = await env.DB.batch([
    env.DB.prepare('SELECT id FROM pets WHERE owner_id = ? AND deleted_at IS NULL').bind(id),
    env.DB.prepare('SELECT id FROM appointments WHERE owner_id = ? AND deleted_at IS NULL').bind(id),
    env.DB.prepare('SELECT id FROM sales WHERE owner_id = ? AND deleted_at IS NULL').bind(id),
  ])
  const ids = (r) => r.results.map((x) => x.id)
  return { owner, petIds: ids(pets), apptIds: ids(appts), saleIds: ids(sales) }
}
const list = (ids) => ids.join(',') || '0'

async function counts(env, s) {
  const [pay, recs] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN voided_at IS NULL THEN amount_cents END), 0) AS cents FROM payments
      WHERE deleted_at IS NULL AND (appointment_id IN (${list(s.apptIds)}) OR sale_id IN (${list(s.saleIds)}) OR owner_id = ?)`).bind(s.owner.id),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM medical_records WHERE deleted_at IS NULL AND pet_id IN (${list(s.petIds)})`),
  ])
  return { pets: s.petIds.length, visits: s.apptIds.length, sales: s.saleIds.length, payments: pay.results[0].n, paid: pay.results[0].cents / 100, records: recs.results[0].n }
}

export async function onRequestGet({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can delete a client and their records.')
  const s = await scope(env, Number(params.id))
  if (!s) return fail(404, 'This owner was not found.')
  return json({ name: s.owner.full_name, customerNo: s.owner.customer_no, ...(await counts(env, s)) })
}

export async function onRequestPost({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can delete a client and their records.')
  const s = await scope(env, Number(params.id))
  if (!s) return fail(404, 'This owner was not found.')
  const typed = String((await readJson(request))?.confirm || '').trim().toLowerCase()
  if (typed !== s.owner.full_name.trim().toLowerCase()) return fail(400, 'Type the owner’s name exactly as shown to confirm.', { errors: { confirm: 'Type the name exactly as shown.' } })
  const before = await counts(env, s)
  const now = new Date().toISOString()
  const by = data.staff.name
  const why = 'Deleted with the owner'
  const A = list(s.apptIds)
  const P = list(s.petIds)
  const S = list(s.saleIds)
  // 1. Payments off (voided and deleted); visits unpaid, so their stock comes back below.
  await env.DB.batch([
    env.DB.prepare(`UPDATE payments SET voided_at = COALESCE(voided_at, ?1), voided_by = COALESCE(voided_by, ?2), void_reason = COALESCE(void_reason, ?3), deleted_at = ?1, deleted_by = ?2
      WHERE deleted_at IS NULL AND (appointment_id IN (${A}) OR sale_id IN (${S}) OR owner_id = ?4)`).bind(now, by, why, s.owner.id),
    env.DB.prepare(`UPDATE appointments SET payment_status = 'unpaid', paid_at = NULL WHERE id IN (${A}) AND payment_status = 'paid'`),
  ])
  for (const id of s.apptIds) await syncVisitStock(env, id, data.staff)
  for (const id of s.saleIds) {
    const { results } = await env.DB.prepare('SELECT product_id, SUM(qty) AS q FROM stock_movements WHERE sale_id = ? GROUP BY product_id HAVING SUM(qty) <> 0').bind(id).all()
    if (results.length) await applyMovements(env, results.map((r) => ({ productId: r.product_id, qty: -r.q, kind: 'reversal', reason: why, saleId: id, staff: data.staff })))
  }
  // 2. Everything else marked deleted.
  await env.DB.batch([
    env.DB.prepare(`UPDATE sales SET voided_at = COALESCE(voided_at, ?1), voided_by = COALESCE(voided_by, ?2), void_reason = COALESCE(void_reason, ?3), deleted_at = ?1, deleted_by = ?2 WHERE id IN (${S})`).bind(now, by, why),
    env.DB.prepare(`UPDATE appointment_items SET deleted_at = ?, deleted_by = ? WHERE appointment_id IN (${A}) AND deleted_at IS NULL`).bind(now, by),
    env.DB.prepare(`UPDATE appointments SET deleted_at = ?, deleted_by = ? WHERE id IN (${A})`).bind(now, by),
    env.DB.prepare(`UPDATE medical_entries SET deleted_at = ?, deleted_by = ? WHERE pet_id IN (${P}) AND deleted_at IS NULL`).bind(now, by),
    env.DB.prepare(`UPDATE medical_records SET deleted_at = ?, deleted_by = ? WHERE pet_id IN (${P}) AND deleted_at IS NULL`).bind(now, by),
    env.DB.prepare(`UPDATE pet_tags SET retired_at = ? WHERE pet_id IN (${P}) AND retired_at IS NULL`).bind(now),
    env.DB.prepare(`UPDATE pets SET deleted_at = ?, deleted_by = ? WHERE id IN (${P})`).bind(now, by),
    env.DB.prepare('UPDATE owners SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(now, `${by} (with all records)`, s.owner.id),
  ])
  await audit(env, data.staff.email, 'delete_with_records', 'owner', s.owner.id, { name: s.owner.full_name, ...before })
  return json({ ok: true, ...before })
}
