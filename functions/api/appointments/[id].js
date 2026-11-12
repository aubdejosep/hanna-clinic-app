// GET   /api/appointments/:id  -> the appointment with its pet, items, staff, notes, history and
//                                  the appointments it was rescheduled from / to
// PATCH /api/appointments/:id  {emergency, reason, staffIds, weightKg, followUpDays, followUpReason}  -> saves only the fields sent
//      weightKg also becomes the pet's latest weight. followUpDays null clears Needs a Follow-Up.

import { json, fail, readJson, clean, cleanMultiline, audit } from '../../../lib/http.js'
import { petOut } from '../../../lib/clients.js'
import { loadAppointment, apptNo, NEXT, fillBlankItems } from '../../../lib/appointments.js'
import { syncVisitRecord, visitRecordId } from '../../../lib/visitRecord.js'

export async function loadFull(env, id) {
  const appt = await loadAppointment(env, id)
  if (!appt) return null
  const [pet, items, staff, notes, events, from, to, tag, later, payments] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(appt.pet.id),
    env.DB.prepare('SELECT * FROM appointment_items WHERE appointment_id = ? AND deleted_at IS NULL ORDER BY id').bind(id),
    env.DB.prepare(`SELECT s.id, s.first_name, s.last_name, s.title, s.role FROM appointment_staff x JOIN staff s ON s.id = x.staff_id
      WHERE x.appointment_id = ? ORDER BY s.first_name`).bind(id),
    env.DB.prepare('SELECT * FROM appointment_notes WHERE appointment_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').bind(id),
    env.DB.prepare('SELECT * FROM appointment_events WHERE appointment_id = ? ORDER BY at, id').bind(id),
    env.DB.prepare('SELECT id, day, time, status FROM appointments WHERE id = (SELECT rescheduled_from FROM appointments WHERE id = ?)').bind(id),
    env.DB.prepare('SELECT id, day, time, status FROM appointments WHERE rescheduled_from = ? AND deleted_at IS NULL').bind(id),
    env.DB.prepare('SELECT uid FROM pet_tags WHERE pet_id = ? AND retired_at IS NULL LIMIT 1').bind(appt.pet.id),
    env.DB.prepare(`SELECT id, day, time, status FROM appointments WHERE pet_id = ? AND id <> ? AND day > ? AND deleted_at IS NULL
      AND status NOT IN ('cancelled', 'no_show') ORDER BY day, time LIMIT 1`).bind(appt.pet.id, id, appt.day),
    env.DB.prepare('SELECT * FROM payments WHERE appointment_id = ? ORDER BY id').bind(id),
  ])
  const link = (r) => r ? { id: r.id, no: apptNo(r), day: r.day, time: r.time, status: r.status } : null
  const history = events.results.map((e) => ({ at: e.at, from: e.from_status, to: e.to_status, via: e.via, actor: e.actor }))
  return {
    ...appt,
    pet: { ...appt.pet, ...petOut(pet.results[0]), tag: tag.results[0]?.uid || null },
    items: items.results.map((i) => ({ id: i.id, serviceId: i.service_id, variationId: i.variation_id, productId: i.product_id, name: i.name, detail: i.detail, kind: i.kind, qty: i.qty, price: i.price_cents == null ? null : i.price_cents / 100 })),
    due: items.results.reduce((n, i) => n + (i.price_cents || 0) * (i.qty || 1), 0) / 100,
    payments: payments.results.map((p) => ({ id: p.id, at: p.at, due: p.due_cents / 100, amount: p.amount_cents / 100, method: p.method, reference: p.reference, note: p.note,
      by: p.staff_name, voidedAt: p.voided_at, voidedBy: p.voided_by, voidReason: p.void_reason })),
    staff: staff.results.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`.trim(), title: s.title, role: s.role })),
    notes: notes.results.map((n) => ({ id: n.id, author: n.author, staffId: n.staff_id, body: n.body, at: n.created_at })),
    history,
    canUndo: history.length > 1 && !['booking', 'auto', 'import'].includes(history[history.length - 1].via) && !to.results.length,
    next: NEXT[appt.status] || [],
    from: link(from.results[0]),
    to: link(to.results[0]),
    laterBooking: link(later.results[0]),
  }
}

export async function onRequestGet({ env, params, data }) {
  const id = Number(params.id)
  // Visits checked out before visit records existed get theirs the first time they're opened.
  const row = await env.DB.prepare('SELECT id, status, source, payment_status FROM appointments WHERE id = ?').bind(id).first()
  // Not paid yet: items added while their price was still blank take today's price from the price list
  // or the Product List. A paid bill is never changed.
  if (row && row.payment_status === 'unpaid' && !['cancelled', 'no_show'].includes(row.status)) await fillBlankItems(env, id)
  if (row?.status === 'completed' && row.source !== 'legacy' && !(await visitRecordId(env, row, false))) await syncVisitRecord(env, id, data.staff)
  const appt = await loadFull(env, id)
  return appt ? json({ appointment: appt }) : fail(404, 'This appointment was not found.')
}

export async function onRequestPatch({ request, env, params, data }) {
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the changes as JSON.')
  const row = await env.DB.prepare('SELECT id, pet_id, day FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!row) return fail(404, 'This appointment was not found.')
  const now = new Date().toISOString()
  const stmts = []
  const fields = []
  if ('emergency' in body) { stmts.push(env.DB.prepare('UPDATE appointments SET emergency = ?, updated_at = ? WHERE id = ?').bind(body.emergency ? 1 : 0, now, id)); fields.push('emergency') }
  if ('reason' in body) { stmts.push(env.DB.prepare('UPDATE appointments SET reason = ?, updated_at = ? WHERE id = ?').bind(cleanMultiline(body.reason, 500) || null, now, id)); fields.push('reason') }
  if (Array.isArray(body.staffIds)) {
    const ids = [...new Set(body.staffIds.map(Number).filter(Boolean))].slice(0, 6)
    stmts.push(env.DB.prepare('DELETE FROM appointment_staff WHERE appointment_id = ?').bind(id))
    ids.forEach((s) => stmts.push(env.DB.prepare('INSERT OR IGNORE INTO appointment_staff (appointment_id, staff_id) SELECT ?, id FROM staff WHERE id = ?').bind(id, s)))
    fields.push('staff')
  }
  if ('weightKg' in body) {
    const raw = String(body.weightKg ?? '').replace(/kg$/i, '').trim()
    const kg = raw === '' ? null : Number(raw)
    if (kg !== null && !(kg > 0 && kg < 150)) return fail(400, 'Enter the weight in kg, e.g. 4.5.', { errors: { weightKg: 'Enter the weight in kg, e.g. 4.5.' } })
    const w = kg === null ? null : Math.round(kg * 100) / 100
    stmts.push(env.DB.prepare('UPDATE appointments SET weight_kg = ?, updated_at = ? WHERE id = ?').bind(w, now, id))
    if (w !== null) stmts.push(env.DB.prepare('UPDATE pets SET weight_kg = ?, weight_on = ?, updated_at = ? WHERE id = ? AND (weight_on IS NULL OR weight_on <= ?)').bind(w, row.day, now, row.pet_id, row.day))
    fields.push('weight')
  }
  if ('followUpDays' in body) {
    const days = body.followUpDays === null || body.followUpDays === '' ? null : Math.round(Number(body.followUpDays))
    if (days !== null && !(days >= 1 && days <= 365)) return fail(400, 'Choose in how many days, from 1 to 365.', { errors: { followUpDays: 'Choose 1 to 365 days.' } })
    stmts.push(env.DB.prepare('UPDATE appointments SET follow_up_days = ?, follow_up_reason = ?, follow_up_by = ?, updated_at = ? WHERE id = ?')
      .bind(days, days === null ? null : clean(body.followUpReason, 200) || null, days === null ? null : data.staff.name, now, id))
    fields.push('follow_up')
  }
  if (!stmts.length) return fail(400, 'Nothing to change.')
  await env.DB.batch(stmts)
  if (fields.includes('weight') || fields.includes('follow_up')) await syncVisitRecord(env, id, data.staff) // the visit record shows them
  await audit(env, data.staff.email, 'update', 'appointment', id, { fields })
  return json({ appointment: await loadFull(env, id) })
}
