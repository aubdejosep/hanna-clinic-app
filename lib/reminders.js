// Workflow reminders for the bell and the clinic board. Worked out fresh each time from the data,
// so a reminder clears itself as soon as the step is done; "Not Needed" hides one for everyone.
//
//   follow_up     the vet ticked Needs a Follow-Up, the visit is at Dispense or done, and no later
//                 booking exists for the pet
//   dispense      the visit reached Dispense (or was checked out after it) with no medicines/products
//   no_services   a checked-out visit with nothing under Services & Products
//   no_vet        a checked-out visit with no staff assigned
//   pet_info      a pet added in the app, or at the clinic today, without breed or weight
//   owner_info    an owner added in the app, or at the clinic today, without mobile or email
//
// Only visits from the app (not the imported history) from the last 30 days count.

import { manilaToday } from './http.js'
import { localMobile } from './clients.js'

const DAYS = 30
const visitCols = `a.id, a.day, a.time, a.status, a.pet_id, a.owner_id, a.follow_up_days, a.follow_up_reason, p.name AS pet_name, p.species,
  o.full_name AS owner_name, (SELECT GROUP_CONCAT(x.staff_id) FROM appointment_staff x WHERE x.appointment_id = a.id) AS staff_ids`
const visitFrom = `FROM appointments a JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id
  WHERE a.deleted_at IS NULL AND a.source <> 'legacy' AND a.day >= ?`

const LATER_BOOKING = `EXISTS (SELECT 1 FROM appointments b WHERE b.pet_id = a.pet_id AND b.id <> a.id AND b.deleted_at IS NULL
  AND b.day > a.day AND b.status NOT IN ('cancelled', 'no_show'))`
const HAS_PRODUCT = "EXISTS (SELECT 1 FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL AND i.kind = 'product')"
const HAS_ITEM = 'EXISTS (SELECT 1 FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL)'
const HAS_STAFF = 'EXISTS (SELECT 1 FROM appointment_staff x WHERE x.appointment_id = a.id)'

const nice = (day) => new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function computeReminders(env, { appointmentIds } = {}) {
  const today = manilaToday()
  const since = addDays(today, -DAYS)
  const only = appointmentIds?.length ? ` AND a.id IN (${appointmentIds.map(Number).join(',')})` : ''
  const [followUp, dispense, noItems, noVet, pets, owners, dismissed] = await env.DB.batch([
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.follow_up_days IS NOT NULL AND a.status IN ('dispense', 'completed') AND NOT ${LATER_BOOKING}`).bind(since),
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.dispense_at IS NOT NULL AND a.status IN ('dispense', 'completed') AND NOT ${HAS_PRODUCT}`).bind(since),
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.status = 'completed' AND NOT ${HAS_ITEM}`).bind(since),
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.status = 'completed' AND NOT ${HAS_STAFF}`).bind(since),
    env.DB.prepare(`SELECT p.id, p.name, p.species, p.breed, p.weight_kg, o.id AS owner_id, o.full_name AS owner_name FROM pets p JOIN owners o ON o.id = p.owner_id
      WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND p.deceased_on IS NULL AND (p.breed IS NULL OR p.breed = '' OR p.weight_kg IS NULL)
      AND (p.legacy_added_on IS NULL OR EXISTS (SELECT 1 FROM appointments a WHERE a.pet_id = p.id AND a.day = ? AND a.deleted_at IS NULL
        AND a.status IN ('arrived', 'started', 'inpatient', 'dispense', 'completed')))`).bind(today),
    env.DB.prepare(`SELECT o.id, o.full_name, o.mobile, o.email, o.source FROM owners o
      WHERE o.deleted_at IS NULL AND (o.mobile IS NULL OR o.email IS NULL OR o.email = '')
      AND (o.source <> 'legacy' OR EXISTS (SELECT 1 FROM appointments a WHERE a.owner_id = o.id AND a.day = ? AND a.deleted_at IS NULL
        AND a.status IN ('arrived', 'started', 'inpatient', 'dispense', 'completed')))`).bind(today),
    env.DB.prepare('SELECT key FROM reminder_dismissals'),
  ])
  const hidden = new Set(dismissed.results.map((d) => d.key))
  const out = []
  const visit = (kind, r, title, text, action) => {
    const key = `${kind}:${r.id}`
    if (hidden.has(key)) return
    out.push({
      key, kind, title, text, action, day: r.day, appointmentId: r.id,
      pet: { id: r.pet_id, name: r.pet_name, species: r.species }, owner: { id: r.owner_id, name: r.owner_name },
      staffIds: r.staff_ids ? String(r.staff_ids).split(',').map(Number) : [],
    })
  }
  for (const r of followUp.results) visit('follow_up', r, `Book ${r.pet_name}'s follow-up`, `Needed in ${r.follow_up_days} day${r.follow_up_days === 1 ? '' : 's'} (by ${nice(addDays(r.day, r.follow_up_days))})${r.follow_up_reason ? `: ${r.follow_up_reason}` : ''}. No booking yet.`, 'Book Follow-Up')
  for (const r of dispense.results) visit('dispense', r, `Add what was dispensed to ${r.pet_name}`, 'The visit went to Dispense but no medicines or products are on it.', 'Add Medicines')
  for (const r of noItems.results) visit('no_services', r, `No services on ${r.pet_name}'s visit`, 'Checked out with nothing under Services & Products.', 'Add Services')
  for (const r of noVet.results) visit('no_vet', r, `No vet on ${r.pet_name}'s visit`, 'Checked out with no staff assigned.', 'Assign Staff')
  if (!appointmentIds) {
    for (const p of pets.results) {
      const key = `pet_info:${p.id}`
      if (hidden.has(key)) continue
      const missing = [!p.breed && 'breed', p.weight_kg == null && 'weight'].filter(Boolean)
      out.push({ key, kind: 'pet_info', title: `${p.name}: add ${missing.join(' and ')}`, text: `${p.name}'s ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. Doses go by weight.`, action: 'Edit Pet', pet: { id: p.id, name: p.name, species: p.species }, owner: { id: p.owner_id, name: p.owner_name }, staffIds: [] })
    }
    for (const o of owners.results) {
      const key = `owner_info:${o.id}`
      if (hidden.has(key)) continue
      const missing = [!o.mobile && 'mobile number', !o.email && 'email'].filter(Boolean)
      out.push({ key, kind: 'owner_info', title: `${o.full_name}: add ${missing.join(' and ')}`, text: `Needed for booking confirmations and reminders.${o.mobile ? ` Mobile on file: ${localMobile(o.mobile)}.` : ''}`, action: 'Edit Owner', owner: { id: o.id, name: o.full_name }, staffIds: [] })
    }
  }
  return out
}

// Vets see what's theirs (assigned to them, or nobody's yet); everyone else sees everything.
export function forStaff(list, staff) {
  if (staff.role !== 'vet') return list
  return list.filter((r) => !r.appointmentId || !r.staffIds.length || r.staffIds.includes(staff.id))
}
