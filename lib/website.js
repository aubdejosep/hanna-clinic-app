// Website bookings (hannapetwellnesscenter.com/book) -> Appointments.
//
// The website saves bookings in its own D1 database (hanna-leads). This reads the new ones (binding
// LEADS) and adds them here, at most once every 2 minutes, whenever staff have the app open (the lists and
// the bell call it). One appointment per pet, Accepted, Booked By "Website".
//   * Owner: matched by mobile; otherwise created and flagged "Booked online: check their details".
//   * Pet: matched by name under that owner; otherwise created with the breed, sex and weight given.
//   * Time: the website asks Morning / Afternoon / Any, so: opening time, 1 PM, opening time; the
//     preference and the services ticked are kept in the visit notes. Free consult codes become a FREE CONSULTATION item.
//   * A booking cancelled on the website (by staff on /staff, or by the client from their email link) is
//     cancelled here too, if it hasn't started. A client's change creates a new booking on the website
//     ("Client (changed to BK-…)"): the new appointment is linked to the old one as a reschedule.
//   * Pets: weightKg is used as the weight; ageYears/ageMonths give an estimated birthdate (only where
//     the pet has none). The website's handover note: website repo, docs/CLINIC-APP-HANDOVER.md.
// Nothing is ever written to the website's database.

import { manilaToday } from './http.js'
import { nextCustomerNo } from './clients.js'
import { startsAt, moveTo } from './appointments.js'
import { standardBreed } from '../scripts/breeds.mjs'

const EVERY_MS = 2 * 60 * 1000
// What the owner ticked online goes in the visit notes, not on the bill: the vet adds the real services.
const ASKED = {
  checkup: 'Check-up', vaccine: 'Vaccination and deworming', lab: 'Laboratory and imaging', surgery: 'Surgery', grooming: 'Grooming',
  confinement: 'Confinement', travel: 'Pet travel or Blood Titer Testing',
}
const TIME_LABEL = { morning: 'Morning', afternoon: 'Afternoon', any: 'Any time' }
const TRAVEL_LABEL = { ph: 'within the Philippines', japan: 'to Japan', other: 'to another country' }
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function json(text, fallback) {
  try { return JSON.parse(text || '') } catch { return fallback }
}
function slot(day, pref, hours) {
  const h = hours?.[DAY_KEYS[new Date(`${day}T00:00:00Z`).getUTCDay()]]
  const open = h?.open || '09:00'
  if (pref === 'afternoon') return open > '13:00' ? open : '13:00'
  return open
}
function petWeight(p) {
  const n = Number(p.weightKg)
  return n >= 0.1 && n <= 150 ? Math.round(n * 100) / 100 : weightKg(p.weight)
}
// Estimated birthdate: the booking's day (Manila) minus the age the owner gave.
function birthEstimate(p, createdAt) {
  const y = Number.isInteger(p.ageYears) ? p.ageYears : null
  const m = Number.isInteger(p.ageMonths) ? p.ageMonths : null
  if (y === null && m === null) return null
  const base = new Date(Date.parse(createdAt || new Date().toISOString()) + 8 * 3600e3)
  const d = new Date(Date.UTC(base.getUTCFullYear() - (y || 0), base.getUTCMonth() - (m || 0), 1))
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(base.getUTCDate(), last))
  return d.toISOString().slice(0, 10)
}
const cancelReason = (statusBy) => /^Client \(changed to/i.test(statusBy || '') ? 'Rescheduled by the client online'
  : /^Client/i.test(statusBy || '') ? 'Cancelled by the client online' : 'Cancelled on the website'
function weightKg(text) {
  const n = Number(String(text || '').replace(',', '.').match(/\d+(\.\d+)?/)?.[0])
  return n > 0 && n < 150 ? Math.round(n * 100) / 100 : null
}

export async function pullWebsiteBookings(env, { force = false } = {}) {
  if (!env.LEADS) return { skipped: 'not linked' }
  const now = new Date()
  if (!force) {
    const last = await env.DB.prepare("SELECT at FROM sync_state WHERE key = 'website_bookings'").first()
    if (last && now - Date.parse(last.at) < EVERY_MS) return { skipped: 'recent' }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value, at) VALUES ('website_bookings', NULL, ?)").bind(now.toISOString()).run()

  const today = manilaToday(now)
  const [bookings, branch, changes] = await Promise.all([
    env.LEADS.prepare(`SELECT * FROM bookings WHERE preferred_date >= ? ORDER BY created_at`).bind(today).all(),
    env.DB.prepare('SELECT hours FROM branches WHERE id = 1').first(),
    env.LEADS.prepare(`SELECT ref, status_by FROM bookings WHERE created_at >= ? AND status = 'cancelled' AND status_by LIKE 'Client (changed to %'`)
      .bind(new Date(now - 60 * 864e5).toISOString()).all(),
  ])
  const changedFrom = new Map() // new ref -> old ref, for client changes
  for (const c of changes.results) {
    const m = String(c.status_by).match(/changed to (BK-[A-Z0-9]+)/i)
    if (m) changedFrom.set(m[1].toUpperCase(), c.ref)
  }
  // Only the appointments for these bookings (and the bookings they replaced), by index.
  const refs = []
  for (const b of bookings.results) json(b.pets, []).forEach((_, i) => refs.push(`${b.ref}#${i}`))
  for (const c of changes.results) for (let i = 0; i < 5; i++) refs.push(`${c.ref}#${i}`)
  const have = new Map()
  for (let k = 0; k < refs.length; k += 90) {
    const part = refs.slice(k, k + 90)
    const { results } = await env.DB.prepare(`SELECT id, status, external_ref FROM appointments INDEXED BY idx_appointments_external
      WHERE external_ref IN (${part.map(() => '?').join(',')}) AND +deleted_at IS NULL`).bind(...part).all()
    for (const a of results) have.set(a.external_ref, a)
  }
  const hours = json(branch?.hours, {})
  let added = 0
  let cancelled = 0
  for (const b of bookings.results) {
    const pets = json(b.pets, [])
    if (b.status === 'cancelled') { // cancelled on the website's /staff page
      for (let i = 0; i < pets.length; i++) {
        const a = have.get(`${b.ref}#${i}`)
        if (a && ['accepted', 'pending'].includes(a.status)) {
          await moveTo(env, a, 'cancelled', { via: 'button', actor: 'Website' })
          await env.DB.prepare('UPDATE appointments SET cancel_reason = ? WHERE id = ?').bind(cancelReason(b.status_by), a.id).run()
          a.status = 'cancelled'
          cancelled++
        }
      }
      continue
    }
    if (pets.every((_, i) => have.has(`${b.ref}#${i}`))) continue
    const owner = await ownerFor(env, b)
    const codes = String(b.free_consult_code || '').split(',').map((c) => c.trim()).filter(Boolean)
    const services = json(b.services, [])
    for (let i = 0; i < pets.length; i++) {
      const ref = `${b.ref}#${i}`
      if (have.has(ref)) continue
      const pet = await petFor(env, owner, pets[i], b.created_at)
      const oldRef = changedFrom.get(String(b.ref).toUpperCase())
      const old = oldRef ? have.get(`${oldRef}#${i}`) : null
      const time = slot(b.preferred_date, b.preferred_time, hours)
      const notes = [
        `Online booking ${b.ref}. Preferred time: ${TIME_LABEL[b.preferred_time] || 'Any time'}.`,
        !codes.length && services.length && `Asked for: ${services.map((x) => ASKED[x] || String(x)).join(', ')}.`,
        b.notes && `Owner's note: ${b.notes}`,
        b.travel && b.travel !== 'no' && `Travelling ${TRAVEL_LABEL[b.travel] || 'soon'}: ask about the requirements.`,
        pets[i].age && `Age given: ${pets[i].age}.`,
      ].filter(Boolean).join('\n')
      const appt = await env.DB.prepare(`INSERT INTO appointments
        (pet_id, owner_id, day, time, starts_at, status, kind, source, reason, booked_by_name, external_ref, created_at, rescheduled_from, reschedule_reason)
        VALUES (?, ?, ?, ?, ?, 'accepted', 'booking', 'website', ?, 'Website', ?, ?, ?, ?) RETURNING id`)
        .bind(pet.id, owner.id, b.preferred_date, time, startsAt(b.preferred_date, time), notes, ref, b.created_at || now.toISOString(),
          old?.id || null, old ? 'Changed by the client online' : null).first()
      const items = codes.length ? [['FREE CONSULTATION', codes[i] || codes[0]]] : []
      await env.DB.batch([
        env.DB.prepare('INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) VALUES (?, ?, NULL, ?, ?, ?)')
          .bind(appt.id, now.toISOString(), 'accepted', 'booking', 'Website'),
        ...items.map(([name, detail]) => env.DB.prepare("INSERT INTO appointment_items (appointment_id, name, detail, kind, added_by) VALUES (?, ?, ?, 'custom', 'Website')").bind(appt.id, name, detail)),
        env.DB.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES ('website', 'book', 'appointment', ?, ?)").bind(String(appt.id), JSON.stringify({ ref })),
      ])
      have.set(ref, { id: appt.id, status: 'accepted', external_ref: ref })
      added++
    }
  }
  return { added, cancelled }
}

async function ownerFor(env, b) {
  if (b.mobile) {
    const { results } = await env.DB.prepare('SELECT * FROM owners WHERE mobile = ? AND deleted_at IS NULL ORDER BY id').bind(b.mobile).all()
    if (results.length) {
      const names = json(b.pets, []).map((p) => String(p.name || '').toLowerCase())
      for (const o of results) {
        const hit = await env.DB.prepare(`SELECT 1 FROM pets WHERE owner_id = ? AND deleted_at IS NULL AND lower(name) IN (${names.map(() => '?').join(',') || "''"}) LIMIT 1`).bind(o.id, ...names).first()
        if (hit) return o
      }
      const o = results[0]
      if (!o.email && b.email && !/^vpnoemail/i.test(b.email)) await env.DB.prepare('UPDATE owners SET email = ?, updated_at = ? WHERE id = ?').bind(b.email, new Date().toISOString(), o.id).run()
      return o
    }
  }
  const customerNo = await nextCustomerNo(env)
  return env.DB.prepare(`INSERT INTO owners (customer_no, full_name, mobile, email, messenger, marketing_consent, source, review_flags)
    VALUES (?, ?, ?, ?, ?, ?, 'website', '["website"]') RETURNING *`)
    .bind(customerNo, String(b.owner_name || 'Online client').trim(), b.mobile || null, b.email || null, b.messenger_name || null, b.marketing_consent ? 1 : 0).first()
}

async function petFor(env, owner, p, createdAt) {
  const name = String(p.name || 'Pet').trim()
  const found = await env.DB.prepare('SELECT * FROM pets WHERE owner_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL ORDER BY id LIMIT 1').bind(owner.id, name).first()
  const kg = petWeight(p)
  const born = birthEstimate(p, createdAt)
  if (found) {
    if (kg && found.weight_kg == null) await env.DB.prepare('UPDATE pets SET weight_kg = ?, weight_on = ? WHERE id = ?').bind(kg, manilaToday(), found.id).run()
    if (born && !found.birthdate) await env.DB.prepare('UPDATE pets SET birthdate = ? WHERE id = ?').bind(born, found.id).run()
    return found
  }
  const sb = p.breed ? standardBreed(p.breed) : null
  return env.DB.prepare(`INSERT INTO pets (owner_id, name, species, breed, breed_raw, sex, weight_kg, weight_on, birthdate, review_flags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '["website"]') RETURNING *`)
    .bind(owner.id, name, p.species === 'cat' ? 'cat' : 'dog', sb?.breed || null, sb?.changed ? p.breed : null,
      p.sex === 'male' || p.sex === 'female' ? p.sex : 'unknown', kg, kg ? manilaToday() : null, born).first()
}
