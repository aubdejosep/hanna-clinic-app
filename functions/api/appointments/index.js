// GET  /api/appointments?tab=&q=&from=&to=&petId=&ownerId=&staffId=&page=&size=&order=asc|desc
//      -> appointments with pet and owner, plus a count per tab for the same filters.
//      tab: all | accepted (also the old Pending) | arrived | started | inpatient | dispense |
//      completed | cancelled | no_show | emergency | unclosed (left open in the old system). size up to 100 (calendar: up to 3000 with cal=1).
// POST /api/appointments {petId, day, time, items, reason, staffIds, emergency}  -> a booking (Accepted)
//      {petId, walkIn: true, items, reason, staffIds}  -> a walk-in, Arrived now
//      {petId, walkIn: true, admit: true, …}           -> Admit Inpatient: checked in and admitted now

import { json, fail, readJson, isoDay, likePattern, manilaToday, cleanMultiline, audit } from '../../../lib/http.js'
import { sweep, LIST_SELECT, apptOut, manilaNow, startsAt, isTime, itemRows, insertItems, loadAppointment } from '../../../lib/appointments.js'
import { pullWebsiteBookings } from '../../../lib/website.js'

const TABS = {
  accepted: "a.status IN ('pending', 'accepted') AND a.legacy_unclosed = 0",
  unclosed: 'a.legacy_unclosed = 1',
  arrived: "a.status = 'arrived'",
  started: "a.status = 'started'",
  inpatient: "a.status = 'inpatient'",
  dispense: "a.status = 'dispense'",
  completed: "a.status = 'completed'",
  cancelled: "a.status = 'cancelled'",
  no_show: "a.status = 'no_show'",
  emergency: 'a.emergency = 1',
}

export async function onRequestGet({ request, env }) {
  await sweep(env)
  await pullWebsiteBookings(env).catch((err) => console.log('Website bookings', String(err).slice(0, 300)))
  const url = new URL(request.url)
  const p = url.searchParams
  const where = ['a.deleted_at IS NULL']
  const binds = []
  const like = likePattern(p.get('q'))
  if (like) {
    where.push(`(p.name LIKE ? OR o.full_name LIKE ? OR o.customer_no LIKE ? OR a.booked_by_name LIKE ?
      OR EXISTS (SELECT 1 FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL AND (i.name LIKE ? OR i.detail LIKE ?)))`)
    binds.push(like, like, like, like, like, like)
  }
  const from = isoDay(p.get('from'))
  const to = isoDay(p.get('to'))
  if (from) { where.push('a.day >= ?'); binds.push(from) }
  if (to) { where.push('a.day <= ?'); binds.push(to) }
  for (const [key, col] of [['petId', 'a.pet_id'], ['ownerId', 'a.owner_id']]) {
    const v = Number(p.get(key))
    if (v) { where.push(`${col} = ?`); binds.push(v) }
  }
  const staffId = Number(p.get('staffId'))
  if (staffId) { where.push('EXISTS (SELECT 1 FROM appointment_staff x WHERE x.appointment_id = a.id AND x.staff_id = ?)'); binds.push(staffId) }

  const base = where.join(' AND ')
  const tab = TABS[p.get('tab')] ? p.get('tab') : 'all'
  const listWhere = tab === 'all' ? base : `${base} AND ${TABS[tab]}`
  const cal = p.get('cal') === '1'
  const size = Math.min(cal ? 3000 : 100, Math.max(1, Number(p.get('size')) || 25))
  const page = Math.max(1, Number(p.get('page')) || 1)
  const order = p.get('order') === 'asc' ? 'ASC' : 'DESC'
  const from_ = 'FROM appointments a JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id'

  const [counts, total, rows] = await env.DB.batch([
    env.DB.prepare(`SELECT a.status, a.emergency, a.legacy_unclosed AS unclosed, COUNT(*) AS n ${from_} WHERE ${base} GROUP BY a.status, a.emergency, a.legacy_unclosed`).bind(...binds),
    env.DB.prepare(`SELECT COUNT(*) AS n ${from_} WHERE ${listWhere}`).bind(...binds),
    env.DB.prepare(`${LIST_SELECT} WHERE ${listWhere} ORDER BY a.day ${order}, a.time ${order}, a.id ${order} LIMIT ? OFFSET ?`)
      .bind(...binds, size, (page - 1) * size),
  ])
  const tabs = { all: 0, accepted: 0, arrived: 0, started: 0, inpatient: 0, dispense: 0, completed: 0, cancelled: 0, no_show: 0, emergency: 0, unclosed: 0 }
  for (const c of counts.results) {
    tabs.all += c.n
    if (c.unclosed) tabs.unclosed += c.n
    else tabs[c.status === 'pending' ? 'accepted' : c.status] += c.n
    if (c.emergency) tabs.emergency += c.n
  }
  return json({ page, pageSize: size, total: total.results[0].n, tabs, today: manilaToday(), appointments: rows.results.map(apptOut) })
}

export async function onRequestPost({ request, env, data }) {
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the appointment as JSON.')
  const me = data.staff
  const pet = await env.DB.prepare(`SELECT p.*, o.deleted_at AS owner_removed FROM pets p JOIN owners o ON o.id = p.owner_id
    WHERE p.id = ? AND p.deleted_at IS NULL`).bind(Number(body.petId) || 0).first()
  if (!pet || pet.owner_removed) return fail(400, 'Choose the pet for this appointment.')
  if (pet.deceased_on) return fail(400, `${pet.name} is marked as passed away, so they can't be booked.`)

  const walkIn = body.walkIn === true
  const now = manilaNow()
  const errors = {}
  let day = now.day
  let time = now.time
  if (!walkIn) {
    day = isoDay(body.day)
    time = String(body.time || '')
    if (!day) errors.day = 'Choose the day.'
    else if (day < now.day) errors.day = 'Choose today or a later day.'
    if (!isTime(time)) errors.time = 'Choose the time.'
  }
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  if (walkIn) {
    const open = await env.DB.prepare(`SELECT id FROM appointments WHERE pet_id = ? AND day = ? AND status IN ('arrived', 'started', 'inpatient', 'dispense') AND deleted_at IS NULL`)
      .bind(pet.id, day).first()
    if (open) return fail(409, `${pet.name} is already checked in today.`, { appointmentId: open.id })
  }

  const items = await itemRows(env, body.items)
  const iso = new Date().toISOString()
  const admit = walkIn && body.admit === true
  const status = admit ? 'inpatient' : walkIn ? 'arrived' : 'accepted'
  const appt = await env.DB.prepare(`INSERT INTO appointments
    (pet_id, owner_id, day, time, starts_at, status, kind, source, emergency, reason, checked_in_at, admitted_at, booked_by_staff_id, booked_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(pet.id, pet.owner_id, day, time, startsAt(day, time), status, walkIn ? 'walk_in' : Number(body.followUpOf) ? 'follow_up' : 'booking', body.emergency ? 1 : 0,
      cleanMultiline(body.reason, 500) || null, walkIn ? iso : null, admit ? iso : null, me.id, me.name)
    .first()
  const staffIds = [...new Set((Array.isArray(body.staffIds) ? body.staffIds : []).map(Number).filter(Boolean))].slice(0, 6)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) VALUES (?, ?, NULL, ?, ?, ?)')
      .bind(appt.id, iso, status, 'booking', me.name),
    ...insertItems(env, appt.id, items, me.name),
    ...staffIds.map((s) => env.DB.prepare('INSERT OR IGNORE INTO appointment_staff (appointment_id, staff_id) SELECT ?, id FROM staff WHERE id = ?').bind(appt.id, s)),
  ])
  await audit(env, me.email, admit ? 'admit' : walkIn ? 'walk_in' : 'book', 'appointment', appt.id, { petId: pet.id, day, time })
  return json({ appointment: await loadAppointment(env, appt.id) }, 201)
}
