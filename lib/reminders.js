// Workflow reminders for the bell and the clinic board. Worked out fresh each time from the data,
// so a reminder clears itself as soon as the step is done; "Not Needed" hides one for everyone.
//
//   follow_up     the vet ticked Needs a Follow-Up, the visit is at Dispense or done, and no later
//                 booking exists for the pet
//   dispense      the visit reached Dispense (or was checked out after it) with no medicines/products
//   unpaid        a visit checked out (tag tap-out) without a payment: its stock stays on the shelf
//                 in the books until it's paid
//   low_stock     counted products at or below their reorder level (one reminder for all)
//   expiring      stock expiring within 60 days (one reminder for all)
//   no_services   a checked-out, confirmed visit with nothing under Services & Products
//   no_vet        a checked-out visit with no staff assigned
//   pet_info      a pet added in the app, or at the clinic today, without breed or weight
//   owner_info    an owner added in the app, or at the clinic today, without mobile or email
//   website_client a new client created from a website booking, until staff Mark as Checked
//   online_booking every booking made on the website (one per booking, all its pets), until staff Mark as
//                 Seen, the visit moves on from Accepted (checked in, cancelled…), or the day passes.
//                 Only bookings made in the last 7 days.
//   balance       an owner at the clinic today (checked in) still owes money (lib/balances.js).
//                 Notifications page only (inBell: false), so the front desk collects it at payment.
//
// Only visits from the app (not the imported history) from the last 30 days count.

import { manilaToday } from './http.js'
import { localMobile } from './clients.js'
import { openItems } from './balances.js'

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
  const [followUp, dispense, noItems, noVet, pets, owners, dismissed, webClients, unpaid, low, expiring, webBookings] = await env.DB.batch([
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.follow_up_days IS NOT NULL AND a.status IN ('dispense', 'completed') AND NOT ${LATER_BOOKING}`).bind(since),
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.dispense_at IS NOT NULL AND a.status IN ('dispense', 'completed') AND NOT ${HAS_PRODUCT}`).bind(since),
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.status = 'completed' AND a.items_confirmed_at IS NOT NULL AND NOT ${HAS_ITEM}`).bind(since),
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.status = 'completed' AND NOT ${HAS_STAFF}`).bind(since),
    // Candidates come from indexes only: pets added in the app (partial index) or at the clinic today.
    env.DB.prepare(`SELECT p.id, p.name, p.species, p.breed, p.weight_kg, o.id AS owner_id, o.full_name AS owner_name FROM pets p JOIN owners o ON o.id = p.owner_id
      WHERE p.id IN (SELECT id FROM pets INDEXED BY idx_pets_app_added WHERE legacy_added_on IS NULL AND created_at >= ?
          UNION SELECT pet_id FROM appointments WHERE day = ? AND status IN ('arrived', 'started', 'inpatient', 'dispense', 'completed') AND deleted_at IS NULL)
        AND p.deleted_at IS NULL AND o.deleted_at IS NULL AND p.deceased_on IS NULL AND (p.breed IS NULL OR p.breed = '' OR p.weight_kg IS NULL)`).bind(`${since}T00:00:00`, today),
    env.DB.prepare(`SELECT o.id, o.full_name, o.mobile, o.email, o.source FROM owners o
      WHERE o.id IN (SELECT id FROM owners WHERE source IN ('staff', 'website', 'walk_in') AND created_at >= ?
          UNION SELECT owner_id FROM appointments WHERE day = ? AND status IN ('arrived', 'started', 'inpatient', 'dispense', 'completed') AND deleted_at IS NULL)
        AND o.deleted_at IS NULL AND (+o.mobile IS NULL OR +o.email IS NULL OR +o.email = '')`).bind(`${since}T00:00:00`, today),
    env.DB.prepare('SELECT key FROM reminder_dismissals'),
    env.DB.prepare(`SELECT id, full_name, created_at FROM owners WHERE source = 'website' AND deleted_at IS NULL AND review_flags LIKE '%"website"%' ORDER BY created_at DESC LIMIT 50`),
    env.DB.prepare(`SELECT ${visitCols} ${visitFrom}${only} AND a.status = 'completed' AND a.payment_status = 'unpaid'`).bind(since),
    env.DB.prepare(`SELECT COUNT(*) AS n, SUM(on_hand <= 0) AS out FROM products WHERE deleted_at IS NULL AND active = 1 AND counted_at IS NOT NULL
      AND on_hand <= COALESCE(reorder_level, 0)`),
    env.DB.prepare(`SELECT COUNT(DISTINCT product_id) AS n, MIN(expiry) AS first FROM stock_batches WHERE remaining > 0 AND expiry IS NOT NULL AND expiry <= ?`).bind(addDays(today, 60)),
    env.DB.prepare(`SELECT a.id, a.day, a.reason, a.external_ref, a.pet_id, a.owner_id, p.name AS pet_name, p.species, o.full_name AS owner_name,
        EXISTS (SELECT 1 FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL AND i.name = 'FREE CONSULTATION') AS free
      FROM appointments a JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id
      WHERE a.source = 'website' AND a.deleted_at IS NULL AND a.status IN ('accepted', 'pending') AND a.day >= ? AND a.created_at >= ?
      ORDER BY a.day, a.id LIMIT 100`).bind(today, addDays(today, -7)),
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
  for (const r of unpaid.results) visit('unpaid', r, `Take payment for ${r.pet_name}`, 'Checked out without a payment. Its medicines stay on the stock count until it is paid.', 'Take Payment')
  for (const r of noItems.results) visit('no_services', r, `No services on ${r.pet_name}'s visit`, 'Checked out with nothing under Services & Products.', 'Add Services')
  for (const r of noVet.results) visit('no_vet', r, `No vet on ${r.pet_name}'s visit`, 'Checked out with no staff assigned.', 'Assign Staff')
  if (!appointmentIds) {
    for (const p of pets.results) {
      const key = `pet_info:${p.id}`
      if (hidden.has(key)) continue
      const missing = [!p.breed && 'breed', p.weight_kg == null && 'weight'].filter(Boolean)
      out.push({ key, kind: 'pet_info', title: `${p.name}: add ${missing.join(' and ')}`, text: `${p.name}'s ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. Doses go by weight.`, action: 'Edit Pet', pet: { id: p.id, name: p.name, species: p.species }, owner: { id: p.owner_id, name: p.owner_name }, staffIds: [] })
    }
    const l = low.results[0]
    if (l?.n && !hidden.has(`low_stock:${today}`)) out.push({ key: `low_stock:${today}`, kind: 'low_stock', title: `${l.n} item${l.n > 1 ? 's' : ''} low on stock`, text: `${l.out ? `${l.out} out of stock. ` : ''}At or below the reorder level.`, action: 'View Stock', staffIds: [] })
    const e = expiring.results[0]
    if (e?.n && !hidden.has(`expiring:${today}`)) out.push({ key: `expiring:${today}`, kind: 'expiring', title: `${e.n} item${e.n > 1 ? 's' : ''} expiring soon`, text: `The first on ${nice(e.first)}. Use these first, or set them aside.`, action: 'View Stock', staffIds: [] })
    for (const o of webClients.results) {
      const key = `website_client:${o.id}`
      if (hidden.has(key)) continue
      out.push({ key, kind: 'website_client', title: `New online client: ${o.full_name}`, text: 'Booked on the website. Check their details and pets, then Mark as Checked.', action: 'Check Details', owner: { id: o.id, name: o.full_name }, staffIds: [] })
    }
    const bookings = new Map() // one item per website booking (its pets share the ref before '#')
    for (const r of webBookings.results) {
      const ref = String(r.external_ref || r.id).split('#')[0]
      if (!bookings.has(ref)) bookings.set(ref, [])
      bookings.get(ref).push(r)
    }
    for (const list of bookings.values()) {
      const r = list[0]
      const key = `online_booking:${r.id}`
      if (hidden.has(key)) continue
      const names = list.map((x) => x.pet_name)
      const when = /Preferred time: ([^.\n]+)\./.exec(r.reason || '')?.[1] || 'Any time'
      out.push({ key, kind: 'online_booking', title: `New online booking: ${names.join(', ')} (${r.owner_name})`,
        text: `${when}${list.some((x) => x.free) ? '. Free first consultation' : ''}. Booked on the website.`, action: 'View Booking',
        day: r.day, appointmentId: r.id, pet: { id: r.pet_id, name: r.pet_name, species: r.species }, owner: { id: r.owner_id, name: r.owner_name }, staffIds: [] })
    }
    for (const o of owners.results) {
      const key = `owner_info:${o.id}`
      if (hidden.has(key)) continue
      const missing = [!o.mobile && 'mobile number', !o.email && 'email'].filter(Boolean)
      out.push({ key, kind: 'owner_info', title: `${o.full_name}: add ${missing.join(' and ')}`, text: `Needed for booking confirmations and reminders.${o.mobile ? ` Mobile on file: ${localMobile(o.mobile)}.` : ''}`, action: 'Edit Owner', owner: { id: o.id, name: o.full_name }, staffIds: [] })
    }
    const here = await env.DB.prepare(`SELECT DISTINCT a.owner_id, o.full_name FROM appointments a JOIN owners o ON o.id = a.owner_id
      WHERE a.day = ? AND a.status IN ('arrived', 'started', 'inpatient', 'dispense', 'completed') AND a.deleted_at IS NULL`).bind(today).all()
    if (here.results.length) {
      const items = await openItems(env, { ownerIds: here.results.map((r) => r.owner_id) })
      for (const o of here.results) {
        const mine = items.filter((i) => i.ownerId === o.owner_id)
        const key = `balance:${o.owner_id}:${today}`
        if (!mine.length || hidden.has(key)) continue
        const total = mine.reduce((s, i) => s + i.left, 0)
        out.push({ key, kind: 'balance', inBell: false, title: `${o.full_name} has a balance of ₱${total.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`,
          text: `At the clinic today. ${mine.length} unpaid item${mine.length > 1 ? 's' : ''}; collect it with today’s payment.`, action: 'View Balance', owner: { id: o.owner_id, name: o.full_name }, staffIds: [] })
      }
    }
  }
  return out
}

// Vets see what's theirs (assigned to them, or nobody's yet); everyone else sees everything.
export function forStaff(list, staff) {
  if (staff.role !== 'vet') return list
  return list.filter((r) => !r.appointmentId || !r.staffIds.length || r.staffIds.includes(staff.id))
}
