// Website bookings (hannapetwellnesscenter.com/book) -> Appointments.
//
// The website saves bookings in its own D1 database (hanna-leads). This reads the new ones (binding
// LEADS) and adds them here, at most once a minute, whenever staff have the app open (the lists and
// the bell call it). One appointment per pet, Accepted, Booked By "Website".
//   * Owner: matched by mobile; otherwise created and flagged "Booked online: check their details".
//   * Pet: matched by name under that owner; otherwise created with the breed, sex and weight given.
//   * Time: the website asks Morning / Afternoon / Any, so: opening time, 1 PM, opening time; the
//     preference is kept in the visit notes. Free consult codes become a FREE CONSULTATION item.
//   * A booking cancelled on the website's /staff page is cancelled here too, if it hasn't started.
// Nothing is ever written to the website's database.

import { manilaToday } from './http.js'
import { nextCustomerNo } from './clients.js'
import { startsAt, moveTo } from './appointments.js'
import { standardBreed } from '../scripts/breeds.mjs'

const EVERY_MS = 60 * 1000
const SERVICE_NAMES = {
  checkup: 'CHECK UP', vaccine: 'VACCINATION / DEWORMING', lab: 'LABORATORY', surgery: 'SURGERY', grooming: 'GROOMING',
  confinement: 'CONFINEMENT', travel: 'PET TRAVEL / BLOOD TITER', freeconsult: 'FREE CONSULTATION',
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
  const [bookings, mine, branch] = await Promise.all([
    env.LEADS.prepare(`SELECT * FROM bookings WHERE preferred_date >= ? ORDER BY created_at`).bind(today).all(),
    env.DB.prepare("SELECT id, status, external_ref FROM appointments WHERE external_ref IS NOT NULL AND deleted_at IS NULL").all(),
    env.DB.prepare('SELECT hours FROM branches WHERE id = 1').first(),
  ])
  const have = new Map(mine.results.map((a) => [a.external_ref, a]))
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
          await env.DB.prepare('UPDATE appointments SET cancel_reason = ? WHERE id = ?').bind('Cancelled on the website', a.id).run()
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
      const pet = await petFor(env, owner, pets[i])
      const time = slot(b.preferred_date, b.preferred_time, hours)
      const notes = [
        `Online booking ${b.ref}. Preferred time: ${TIME_LABEL[b.preferred_time] || 'Any time'}.`,
        b.notes && `Owner's note: ${b.notes}`,
        b.travel && b.travel !== 'no' && `Travelling ${TRAVEL_LABEL[b.travel] || 'soon'}: ask about the requirements.`,
        pets[i].age && `Age given: ${pets[i].age}.`,
      ].filter(Boolean).join('\n')
      const appt = await env.DB.prepare(`INSERT INTO appointments
        (pet_id, owner_id, day, time, starts_at, status, kind, source, reason, booked_by_name, external_ref, created_at)
        VALUES (?, ?, ?, ?, ?, 'accepted', 'booking', 'website', ?, 'Website', ?, ?) RETURNING id`)
        .bind(pet.id, owner.id, b.preferred_date, time, startsAt(b.preferred_date, time), notes, ref, b.created_at || now.toISOString()).first()
      const items = codes.length
        ? [['FREE CONSULTATION', codes[i] || codes[0]]]
        : services.map((s) => [SERVICE_NAMES[s] || String(s).toUpperCase(), null])
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

async function petFor(env, owner, p) {
  const name = String(p.name || 'Pet').trim()
  const found = await env.DB.prepare('SELECT * FROM pets WHERE owner_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL ORDER BY id LIMIT 1').bind(owner.id, name).first()
  const kg = weightKg(p.weight)
  if (found) {
    if (kg && found.weight_kg == null) await env.DB.prepare('UPDATE pets SET weight_kg = ?, weight_on = ? WHERE id = ?').bind(kg, manilaToday(), found.id).run()
    return found
  }
  const sb = p.breed ? standardBreed(p.breed) : null
  return env.DB.prepare(`INSERT INTO pets (owner_id, name, species, breed, breed_raw, sex, weight_kg, weight_on, review_flags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '["website"]') RETURNING *`)
    .bind(owner.id, name, p.species === 'cat' ? 'cat' : 'dog', sb?.breed || null, sb?.changed ? p.breed : null,
      p.sex === 'male' || p.sex === 'female' ? p.sex : 'unknown', kg, kg ? manilaToday() : null).first()
}
