// Appointments: the status steps, how rows are shaped on the way out, and the end-of-day sweep.

import { clean, manilaToday } from './http.js'
import { localMobile } from './clients.js'

export const STATUSES = ['pending', 'accepted', 'arrived', 'started', 'inpatient', 'dispense', 'completed', 'cancelled', 'no_show']
export const OPEN_VISIT = ['arrived', 'started', 'inpatient', 'dispense'] // tapped in, not yet tapped out
export const BOOKED = ['pending', 'accepted']

// Where each status can go with a button (tap in / tap out use the same steps).
export const NEXT = {
  pending: ['accepted', 'arrived', 'cancelled', 'no_show'],
  accepted: ['arrived', 'cancelled', 'no_show'],
  no_show: ['arrived', 'accepted'],
  arrived: ['started', 'completed', 'cancelled'],
  started: ['inpatient', 'dispense', 'completed'],
  inpatient: ['dispense', 'completed'],
  dispense: ['completed'],
  completed: [],
  cancelled: [],
}
// The timestamp each step sets.
export const STAMP = { arrived: 'checked_in_at', started: 'started_at', inpatient: 'admitted_at', dispense: 'dispense_at', completed: 'checked_out_at', cancelled: 'cancelled_at' }

const MANILA_MS = 8 * 60 * 60 * 1000
export function manilaNow(now = new Date()) { // -> { day: '2026-11-10', time: '14:05' }
  const iso = new Date(now.getTime() + MANILA_MS).toISOString()
  return { day: iso.slice(0, 10), time: iso.slice(11, 16) }
}
export function startsAt(day, time) { // Manila day + HH:MM -> UTC ISO
  return new Date(`${day}T${time}:00+08:00`).toISOString()
}
export function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))
}
export function apptNo(r) { // like the old system: #2026A4511
  return `${String(r.day).slice(0, 4)}A${r.id}`
}

// Bookings nobody tapped in for become No Show once their day is over. Runs before lists load,
// so it needs no scheduled job. Imported open rows (legacy_unclosed) are left for the records import.
export async function sweep(env) {
  const today = manilaToday()
  const where = `status IN ('pending', 'accepted') AND day < ? AND legacy_unclosed = 0 AND deleted_at IS NULL`
  const due = await env.DB.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE ${where}`).bind(today).first()
  if (!due?.n) return 0
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor)
      SELECT id, ?, status, 'no_show', 'auto', 'End of day' FROM appointments WHERE ${where}`).bind(now, today),
    env.DB.prepare(`UPDATE appointments SET status = 'no_show', updated_at = ? WHERE ${where}`).bind(now, today),
  ])
  return due.n
}

// The columns every list needs: the appointment plus its pet and owner.
export const LIST_SELECT = `
  SELECT a.*, p.name AS pet_name, p.species AS pet_species, p.breed AS pet_breed, p.deceased_on AS pet_deceased,
    o.full_name AS owner_name, o.customer_no, o.mobile AS owner_mobile,
    (SELECT GROUP_CONCAT(i.name || CASE WHEN i.detail IS NOT NULL AND i.detail <> '' THEN ' · ' || i.detail ELSE '' END, ' | ')
       FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL) AS items_text,
    (SELECT GROUP_CONCAT(s.first_name, ', ') FROM appointment_staff x JOIN staff s ON s.id = x.staff_id WHERE x.appointment_id = a.id) AS staff_text,
    (SELECT n.id FROM appointments n WHERE n.rescheduled_from = a.id AND n.deleted_at IS NULL LIMIT 1) AS rescheduled_to
  FROM appointments a
  JOIN pets p ON p.id = a.pet_id
  JOIN owners o ON o.id = a.owner_id`

export function apptOut(r) {
  return {
    id: r.id,
    no: apptNo(r),
    day: r.day,
    time: r.time,
    startsAt: r.starts_at,
    status: r.status,
    kind: r.kind,
    source: r.source,
    emergency: !!r.emergency,
    reason: r.reason,
    checkedInAt: r.checked_in_at,
    startedAt: r.started_at,
    admittedAt: r.admitted_at,
    dispenseAt: r.dispense_at,
    checkedOutAt: r.checked_out_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    rescheduledFrom: r.rescheduled_from,
    rescheduledTo: r.rescheduled_to ?? null,
    rescheduleReason: r.reschedule_reason,
    bookedBy: r.booked_by_name,
    legacyStatus: r.legacy_status,
    legacyInfo: r.legacy_info,
    legacyUnclosed: !!r.legacy_unclosed,
    weightKg: r.weight_kg ?? null,
    followUpDays: r.follow_up_days ?? null,
    followUpReason: r.follow_up_reason ?? null,
    followUpBy: r.follow_up_by ?? null,
    itemsConfirmedAt: r.items_confirmed_at ?? null,
    itemsConfirmedBy: r.items_confirmed_by ?? null,
    items: r.items_text ? r.items_text.split(' | ') : [],
    staff: r.staff_text ? r.staff_text.split(', ') : [],
    pet: { id: r.pet_id, name: r.pet_name, species: r.pet_species, breed: r.pet_breed, deceasedOn: r.pet_deceased },
    owner: { id: r.owner_id, name: r.owner_name, customerNo: r.customer_no, mobile: r.owner_mobile, mobileLocal: localMobile(r.owner_mobile) },
    createdAt: r.created_at,
  }
}

export async function loadAppointment(env, id) {
  const row = await env.DB.prepare(`${LIST_SELECT} WHERE a.id = ? AND a.deleted_at IS NULL`).bind(id).first()
  return row ? apptOut(row) : null
}

// Changes the status, stamps the time and records the event. -> the updated row, or an error message.
export async function moveTo(env, appt, to, { via = 'button', actor } = {}) {
  if (!STATUSES.includes(to)) return { error: 'Choose a valid step.' }
  if (appt.status === to) return { error: `This appointment is already ${to.replace('_', ' ')}.` }
  if (!(NEXT[appt.status] || []).includes(to)) return { error: `An appointment that is ${appt.status.replace('_', ' ')} can't go to ${to.replace('_', ' ')}.` }
  const now = new Date().toISOString()
  const sets = ['status = ?', 'updated_at = ?', 'legacy_unclosed = 0']
  const binds = [to, now]
  if (STAMP[to]) { sets.push(`${STAMP[to]} = COALESCE(${STAMP[to]}, ?)`); binds.push(now) }
  if (to === 'accepted' || to === 'no_show') sets.push('checked_in_at = NULL')
  await env.DB.batch([
    env.DB.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, appt.id),
    env.DB.prepare('INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(appt.id, now, appt.status, to, via, actor || null),
  ])
  return { ok: true }
}

// Items sent from the booking panel or the appointment page:
// [{serviceId, variationId}] from the price list, [{productId, detail, qty}] from the medicines list,
// or [{name, detail, kind}] typed in. A medicine typed in is added to the medicines list, so next
// time it's one search away.
export async function itemRows(env, list, { actor } = {}) {
  const out = []
  for (const it of (Array.isArray(list) ? list : []).slice(0, 30)) {
    const serviceId = Number(it?.serviceId) || null
    const qty = Math.max(1, Math.min(99, Number(it?.qty) || 1))
    if (serviceId) {
      const s = await env.DB.prepare('SELECT id, name, price_cents FROM services WHERE id = ? AND deleted_at IS NULL').bind(serviceId).first()
      if (!s) continue
      const variationId = Number(it.variationId) || null
      const v = variationId ? await env.DB.prepare('SELECT id, name, price_cents FROM service_variations WHERE id = ? AND service_id = ?').bind(variationId, serviceId).first() : null
      out.push({ service_id: s.id, variation_id: v?.id || null, product_id: null, name: s.name, detail: v?.name || null, kind: 'service', qty: 1, price_cents: v ? v.price_cents : s.price_cents })
      continue
    }
    let product = Number(it?.productId) ? await env.DB.prepare('SELECT id, name FROM products WHERE id = ? AND deleted_at IS NULL').bind(Number(it.productId)).first() : null
    const name = product?.name || clean(it?.name, 60)
    if (!name) continue
    const kind = product || it.kind === 'product' ? 'product' : 'custom'
    if (kind === 'product' && !product) {
      product = await env.DB.prepare('SELECT id, name FROM products WHERE branch_id = 1 AND name = ? COLLATE NOCASE AND deleted_at IS NULL').bind(name).first()
      if (!product) {
        await env.DB.prepare("INSERT OR IGNORE INTO products (name, category, source, created_by) VALUES (?, 'Typed In', 'typed', ?)").bind(name, actor || null).run()
        product = await env.DB.prepare('SELECT id, name FROM products WHERE branch_id = 1 AND name = ? COLLATE NOCASE AND deleted_at IS NULL').bind(name).first()
      }
    }
    out.push({ service_id: null, variation_id: null, product_id: product?.id || null, name: product?.name || name, detail: clean(it.detail, 80) || null, kind, qty, price_cents: null })
  }
  return out
}
export function insertItems(env, appointmentId, rows, actor) {
  return rows.map((r) => env.DB.prepare(`INSERT INTO appointment_items (appointment_id, service_id, variation_id, product_id, name, detail, kind, qty, price_cents, added_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(appointmentId, r.service_id, r.variation_id, r.product_id || null, r.name, r.detail, r.kind, r.qty, r.price_cents, actor))
}
