// GET /api/records?q=&type=&from=&to=&page=&size=
//   -> the Records List: one row per medical record with its pet, owner and entries (newest first).
//      q matches pet, owner, customer number, or an entry's title, description or services.

import { json, isoDay, likePattern, manilaToday } from '../../../lib/http.js'
import { cached } from '../../../lib/cache.js'
import { localMobile } from '../../../lib/clients.js'
import { ENTRY_TYPES, recordOut } from '../../../lib/records.js'

export async function onRequestGet({ request, env }) {
  const p = new URL(request.url).searchParams
  // Booking-only records for future days are just upcoming bookings: those are under Appointments.
  const where = ['m.deleted_at IS NULL', 'NOT (m.booking_only = 1 AND m.day > ?)']
  const binds = [manilaToday()]
  const like = likePattern(p.get('q'))
  if (like) {
    where.push(`(pt.name LIKE ? OR o.full_name LIKE ? OR o.customer_no LIKE ? OR EXISTS (SELECT 1 FROM medical_entries e WHERE e.record_id = m.id
      AND e.deleted_at IS NULL AND (e.title LIKE ? OR e.description LIKE ? OR e.items LIKE ?)))`)
    binds.push(like, like, like, like, like, like)
  }
  const type = p.get('type')
  if (ENTRY_TYPES.includes(type)) { where.push('EXISTS (SELECT 1 FROM medical_entries e WHERE e.record_id = m.id AND e.deleted_at IS NULL AND e.type = ?)'); binds.push(type) }
  const from = isoDay(p.get('from'))
  const to = isoDay(p.get('to'))
  if (from) { where.push('m.day >= ?'); binds.push(from) }
  if (to) { where.push('m.day <= ?'); binds.push(to) }
  const size = Math.min(100, Math.max(1, Number(p.get('size')) || 25))
  const page = Math.max(1, Number(p.get('page')) || 1)
  const base = `FROM medical_records m JOIN pets pt ON pt.id = m.pet_id JOIN owners o ON o.id = m.owner_id WHERE ${where.join(' AND ')}`
  // Without a search or filter the total only changes with an import: worked out once an hour, not per page.
  const plain = where.length === 2
  const countAll = () => env.DB.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...binds).first().then((r) => r.n)
  const n = plain ? await cached(env, `records_total:${binds[0]}`, 3600e3, countAll) : null
  const [total, rows] = await env.DB.batch([
    plain ? env.DB.prepare('SELECT ? AS n').bind(n) : env.DB.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...binds),
    env.DB.prepare(`SELECT m.*, (SELECT a.status FROM appointments a WHERE a.id = m.appointment_id) AS appt_status, (SELECT a.legacy_status FROM appointments a WHERE a.id = m.appointment_id) AS appt_legacy_status, pt.name AS pet_name, pt.species, o.full_name AS owner_name, o.customer_no, o.mobile ${base}
      ORDER BY m.day DESC, m.id DESC LIMIT ? OFFSET ?`).bind(...binds, size, (page - 1) * size),
  ])
  const ids = rows.results.map((r) => r.id)
  const ents = ids.length ? (await env.DB.prepare(`SELECT * FROM medical_entries WHERE deleted_at IS NULL AND record_id IN (${ids.map(() => '?').join(',')})
    ORDER BY record_id, sort, id`).bind(...ids).all()).results : []
  const by = {}
  for (const e of ents) (by[e.record_id] ||= []).push(e)
  return json({
    page, pageSize: size, total: total.results[0].n,
    records: rows.results.map((r) => ({
      ...recordOut(r, by[r.id] || []),
      pet: { id: r.pet_id, name: r.pet_name, species: r.species },
      owner: { id: r.owner_id, name: r.owner_name, customerNo: r.customer_no, mobileLocal: localMobile(r.mobile) },
    })),
  })
}
