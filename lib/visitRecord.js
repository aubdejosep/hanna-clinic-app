// The medical record of a visit in the app (source 'staff', linked to the appointment).
//
// What staff did at the visit is copied in by itself once the visit is checked out: one "Services and
// Products" entry (with medicines and doses, the weight and any follow-up) and a vaccination entry for
// each vaccine given, so the pet's Vaccinations card stays complete. These automatic entries follow
// the visit: changed when items change, removed if the check-out is undone. What a vet writes (notes,
// diagnosis, prescriptions, treatment plans) is never touched by this.

import { syncVisitStock } from './stock.js'

const isVaccine = (i) => /VACCIN/i.test(i.name || '') || ['ARV', 'KCV'].includes(String(i.name || '').toUpperCase()) || /RABIES/i.test(i.detail || '')

// The visit's record id; with create, makes it if there isn't one yet.
export async function visitRecordId(env, appt, create) {
  const row = await env.DB.prepare("SELECT id FROM medical_records WHERE appointment_id = ? AND source = 'staff' AND deleted_at IS NULL ORDER BY id LIMIT 1").bind(appt.id).first()
  if (row || !create) return row?.id || null
  const made = await env.DB.prepare(`INSERT INTO medical_records (pet_id, owner_id, day, kind, appointment_id, source, legacy_appointment_no)
    VALUES (?, ?, ?, 'visit', ?, 'staff', ?) RETURNING id`).bind(appt.pet_id, appt.owner_id, appt.day, appt.id, `${appt.day.slice(0, 4)}A${appt.id}`).first()
  return made.id
}

export async function syncVisitRecord(env, appointmentId, staff) {
  const a = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(appointmentId).first()
  if (!a || a.source === 'legacy') return
  const done = a.status === 'completed'
  const recId = await visitRecordId(env, a, done)
  if (!recId) return
  const { results: autos } = await env.DB.prepare('SELECT id, auto, title, items, details FROM medical_entries WHERE record_id = ? AND auto IS NOT NULL AND deleted_at IS NULL').bind(recId).all()
  const now = new Date().toISOString()
  const who = staff?.name || 'Check-out'
  const want = []
  if (done) {
    const { results: items } = await env.DB.prepare(`SELECT id, service_id, variation_id, product_id, name, detail, kind, qty FROM appointment_items
      WHERE appointment_id = ? AND deleted_at IS NULL ORDER BY id`).bind(appointmentId).all()
    const shaped = items.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, qty: i.qty, ...(i.product_id ? { productId: i.product_id } : {}) }))
    const details = { visit: true, ...(a.weight_kg != null ? { weightKg: a.weight_kg } : {}), ...(a.follow_up_days ? { followUpDays: a.follow_up_days, followUpReason: a.follow_up_reason || null } : {}) }
    if (shaped.length || details.weightKg != null || details.followUpDays) want.push({ auto: 'services', type: 'note', title: 'Services and Products', items: shaped, details })
    for (const i of items.filter(isVaccine)) want.push({ auto: `vaccine:${i.id}`, type: 'vaccination', title: i.detail || i.name, items: [{ kind: i.kind, name: i.name, detail: i.detail, qty: i.qty }], details: null })
  }
  const writes = []
  const have = new Map(autos.map((e) => [e.auto, e]))
  for (const w of want) {
    const items = JSON.stringify(w.items)
    const details = w.details ? JSON.stringify(w.details) : null
    const e = have.get(w.auto)
    if (e) {
      if (e.items !== items || e.details !== details || e.title !== w.title) {
        writes.push(env.DB.prepare('UPDATE medical_entries SET title = ?, items = ?, details = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(w.title, items, details, now, who, e.id))
      }
      have.delete(w.auto)
    } else {
      writes.push(env.DB.prepare(`INSERT INTO medical_entries (record_id, pet_id, day, type, title, items, details, sort, auto, created_by, staff_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(recId, a.pet_id, a.day, w.type, w.title, items, details, w.auto === 'services' ? 1000 : 1001, w.auto, who, staff?.id || null))
    }
  }
  for (const e of have.values()) writes.push(env.DB.prepare('UPDATE medical_entries SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(now, who, e.id))
  if (writes.length) await env.DB.batch(writes)
}

// After anything that changes a visit (a step, its items, its payment): stock and record follow.
export async function syncVisit(env, appointmentId, staff) {
  await syncVisitStock(env, appointmentId, staff)
  await syncVisitRecord(env, appointmentId, staff)
}
