// VetAssist sync: compares cleaned rows from VetAssist's files (lib/vetassist.js) with the database and,
// when asked, applies the changes. Used by /api/vetassist/:kind (Clinic Operations ▸ Import from VetAssist).
//
// Until go-live nobody works in the app, so VetAssist wins: new rows are added, changed rows are updated.
// Guards:
//   * nothing is deleted: rows in the app but no longer in VetAssist are only counted;
//   * a website client is never overwritten, even if VetAssist gives someone their customer number;
//   * blanks in VetAssist never erase what the app has (an email, a birthdate, a microchip);
//   * services and products: new ones only, so prices and weight bands set in the app stay;
//   * an appointment's status only changes when VetAssist's status changed, so visits the records
//     import settled (Completed / No Show) stay settled.
// Every call returns { new, updated, same, review: [{ what, why }] }; with apply = false nothing is written.

import { appStatus, cancelReason, low, recordSignature } from './vetassist.js'
import { standardBreed } from '../scripts/breeds.mjs'
import { startsAt } from './appointments.js'

const ACTOR = 'VetAssist sync'
const MAX_REVIEW = 200
export const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const tally = () => ({ new: 0, updated: 0, same: 0, review: [] })
const note = (t, what, why) => { t.changes = t.changes || []; if (t.changes.length < MAX_REVIEW) t.changes.push({ what, why }) }
// SQLite's lower() only changes A-Z, so names with Ñ are looked up the way the database lowers them.
const sqlLow = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().replace(/[A-Z]/g, (c) => c.toLowerCase())
const flag = (t, what, why) => { if (t.review.length < MAX_REVIEW) t.review.push({ what, why }); t.reviewCount = (t.reviewCount || 0) + 1 }

// D1 allows up to 100 bound values per statement: look up long lists in slices.
async function selectIn(env, sql, values, extra = []) {
  const list = [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))]
  const out = []
  for (let i = 0; i < list.length; i += 90) {
    const part = list.slice(i, i + 90)
    const { results } = await env.DB.prepare(sql.replace('(?IN)', `(${part.map(() => '?').join(',')})`)).bind(...part, ...extra).all()
    out.push(...results)
  }
  return out
}
async function run(env, stmts) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50))
}
const group = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x) } return m }

// ---------- Owners (Masterlist owners export) ----------
export async function syncOwners(env, rows, { apply }) {
  const t = tally()
  const now = new Date().toISOString()
  const have = new Map((await selectIn(env, 'SELECT id, customer_no, full_name, mobile, mobile_raw, email, vip, source, deleted_at FROM owners WHERE customer_no IN (?IN)', rows.map((r) => r.customerNo))).map((o) => [o.customer_no, o]))
  const newMobiles = rows.filter((r) => !have.has(r.customerNo) && r.mobile).map((r) => r.mobile)
  const appClients = group(await selectIn(env, "SELECT id, customer_no, full_name, mobile FROM owners WHERE deleted_at IS NULL AND source <> 'legacy' AND mobile IN (?IN)", newMobiles), (o) => o.mobile)
  const stmts = []
  t.newNos = []
  for (const r of rows) {
    const ex = have.get(r.customerNo)
    if (!ex) {
      t.new++
      t.newNos.push(r.customerNo)
      const same = appClients.get(r.mobile)
      if (same) flag(t, `${r.customerNo} ${r.name}`, `New in VetAssist, with the same mobile as ${same.map((o) => `${o.full_name} (${o.customer_no}, added in the app)`).join(', ')}. Possibly the same person: merge them after go-live.`)
      const flags = [...(!r.mobile && !r.mobileRaw ? ['no_phone'] : []), ...(r.mobileRaw ? ['check_phone'] : [])]
      stmts.push(env.DB.prepare(`INSERT INTO owners (customer_no, full_name, mobile, mobile_raw, email, vip, source, legacy_added_on, review_flags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'legacy', ?, ?, ?)`).bind(r.customerNo, r.name, r.mobile, r.mobileRaw, r.email, r.vip, r.addedOn, JSON.stringify(flags), now))
      continue
    }
    if (ex.source !== 'legacy') { flag(t, `${r.customerNo} ${r.name}`, `This customer number belongs to ${ex.full_name}, who was added in the app (e.g. a website booking). Not changed: give one of them a new number after go-live.`); continue }
    if (ex.deleted_at) { t.same++; continue } // deleted in the app on purpose: left deleted
    const next = {
      full_name: r.name,
      mobile: r.mobile || (r.mobileRaw ? null : ex.mobile),
      mobile_raw: r.mobile ? null : r.mobileRaw || (r.mobile ? null : ex.mobile_raw),
      email: r.email || ex.email,
      vip: r.vip,
    }
    const changed = Object.keys(next).filter((k) => (next[k] ?? null) !== (ex[k] ?? null))
    if (!changed.length) { t.same++; continue }
    t.updated++
    note(t, `${r.customerNo} ${r.name}`, changed.map((k) => `${k.replace('_', ' ')}: ${ex[k] ?? '—'} → ${next[k] ?? '—'}`).join('; '))
    stmts.push(env.DB.prepare(`UPDATE owners SET ${changed.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...changed.map((k) => next[k] ?? null), now, ex.id))
  }
  if (apply) await run(env, stmts)
  return t
}

// ---------- Pets (Masterlist pets export). Rows arrive grouped by customer number. ----------
export async function syncPets(env, rows, { apply, pendingOwners = [] }) {
  const pending = new Set(apply ? [] : pendingOwners) // preview: owners that the owners file will add
  const t = tally()
  const now = new Date().toISOString()
  const owners = new Map((await selectIn(env, 'SELECT id, customer_no, full_name, source, deleted_at FROM owners WHERE customer_no IN (?IN)', rows.map((r) => r.customerNo))).map((o) => [o.customer_no, o]))
  const pets = group(await selectIn(env, 'SELECT id, owner_id, name, species, breed, breed_raw, sex, birthdate, microchip FROM pets WHERE deleted_at IS NULL AND owner_id IN (?IN) ORDER BY id', [...owners.values()].map((o) => o.id)), (p) => `${p.owner_id}|${low(p.name)}`)
  const used = new Map() // owner|name -> how many rows matched so far (two pets with one name)
  const stmts = []
  for (const r of rows) {
    const o = owners.get(r.customerNo)
    if (!o && pending.has(r.customerNo)) { t.new++; continue }
    if (!o) { flag(t, `${r.name} (${r.customerNo})`, 'Its owner isn’t in VetAssist’s owners file or the app. Check the two files are from the same day.'); continue }
    if (o.source !== 'legacy') { flag(t, `${r.name} (${r.customerNo})`, `Customer number used by ${o.full_name}, added in the app. Not changed.`); continue }
    if (o.deleted_at) { t.same++; continue }
    const k = `${o.id}|${low(r.name)}`
    const n = used.get(k) || 0
    used.set(k, n + 1)
    const ex = (pets.get(k) || [])[n]
    const { breed, changed: breedChanged } = standardBreed(r.breed)
    const breedRaw = breedChanged && r.breed ? r.breed : null
    if (!ex) {
      t.new++
      stmts.push(env.DB.prepare(`INSERT INTO pets (owner_id, name, species, breed, breed_raw, sex, birthdate, microchip, legacy_added_on, review_flags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`).bind(o.id, r.name, r.species, breed, breedRaw, r.sex, r.birthdate, r.microchip, r.addedOn, now))
      continue
    }
    const next = {
      species: r.species, breed: breed ?? ex.breed, breed_raw: breed ? breedRaw : ex.breed_raw,
      sex: r.sex !== 'unknown' ? r.sex : ex.sex, birthdate: r.birthdate || ex.birthdate, microchip: r.microchip || ex.microchip,
    }
    const changed = Object.keys(next).filter((f) => (next[f] ?? null) !== (ex[f] ?? null))
    if (!changed.length) { t.same++; continue }
    t.updated++
    note(t, `${r.name} (${r.customerNo})`, changed.map((f) => `${f.replace('_', ' ')}: ${ex[f] ?? '—'} → ${next[f] ?? '—'}`).join('; '))
    stmts.push(env.DB.prepare(`UPDATE pets SET ${changed.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...changed.map((f) => next[f] ?? null), now, ex.id))
  }
  if (apply) await run(env, stmts)
  return t
}

// ---------- Passed away pets (Deceased Pets export). on: the day to record (the export has none). ----------
export async function syncDeceased(env, rows, { apply, on }) {
  const t = tally()
  const now = new Date().toISOString()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(on || '') ? on : manilaToday()
  const owners = new Map((await selectIn(env, "SELECT id, customer_no FROM owners WHERE deleted_at IS NULL AND source = 'legacy' AND customer_no IN (?IN)", rows.map((r) => r.customerNo))).map((o) => [o.customer_no, o]))
  const pets = group(await selectIn(env, 'SELECT id, owner_id, name, deceased_on FROM pets WHERE deleted_at IS NULL AND owner_id IN (?IN)', [...owners.values()].map((o) => o.id)), (p) => `${p.owner_id}|${low(p.name)}`)
  const stmts = []
  for (const r of rows) {
    const o = owners.get(r.customerNo)
    const list = o ? pets.get(`${o.id}|${low(r.name)}`) || [] : []
    if (!list.length) { flag(t, `${r.name} (${r.customerNo})`, 'Not found in the app. Import owners and pets first.'); continue }
    for (const p of list) {
      if (p.deceased_on) { t.same++; continue }
      t.new++
      stmts.push(env.DB.prepare(`UPDATE appointments SET status = 'cancelled', cancelled_at = ?, cancel_reason = 'Pet passed away', updated_at = ? WHERE pet_id = ? AND status IN ('pending', 'accepted') AND day >= ? AND deleted_at IS NULL`).bind(now, now, p.id, day))
      stmts.push(env.DB.prepare('UPDATE pets SET deceased_on = ?, updated_at = ? WHERE id = ? AND deceased_on IS NULL').bind(day, now, p.id))
    }
  }
  if (apply) await run(env, stmts)
  return t
}

// The pet for "owner name + pet name" (the old lists show names, not numbers): VetAssist owners first.
async function petFinder(env, pairs) {
  const owners = await selectIn(env, 'SELECT id, full_name, mobile, source FROM owners WHERE deleted_at IS NULL AND lower(trim(full_name)) IN (?IN)', pairs.map((p) => sqlLow(p.owner)))
  const byMobile = await selectIn(env, 'SELECT id, full_name, mobile, source FROM owners WHERE deleted_at IS NULL AND mobile IN (?IN)', pairs.map((p) => p.mobile).filter(Boolean))
  const all = new Map([...owners, ...byMobile].map((o) => [o.id, o]))
  const pets = await selectIn(env, 'SELECT id, owner_id, name, birthdate FROM pets WHERE deleted_at IS NULL AND owner_id IN (?IN) ORDER BY id', [...all.keys()])
  const petsBy = group(pets, (p) => `${p.owner_id}|${low(p.name)}`)
  const ownersByName = group([...all.values()], (o) => low(o.full_name))
  const ownersByMobile = group([...all.values()].filter((o) => o.mobile), (o) => o.mobile)
  const rank = (o) => (o.source === 'legacy' ? 0 : 1)
  return ({ owner, pet, mobile }) => {
    for (const list of [ownersByName.get(low(owner)) || [], mobile ? ownersByMobile.get(mobile) || [] : []]) {
      const hits = [...list].sort((a, b) => rank(a) - rank(b)).flatMap((o) => (petsBy.get(`${o.id}|${low(pet)}`) || []).map((p) => ({ ...p, ownerId: o.id, ownerSource: o.source })))
      if (hits.length) return { ...hits[0], ambiguous: hits.length > 1 }
    }
    return null
  }
}

// ---------- Appointments (appointments.jsonl) ----------
export async function syncAppointments(env, rows, { apply }) {
  const t = tally()
  const now = new Date().toISOString()
  const today = manilaToday()
  const find = await petFinder(env, rows.map((r) => ({ owner: r.owner, pet: r.pet })))
  const byKey = new Map((await selectIn(env, "SELECT id, pet_id, day, time, status, legacy_status, legacy_info, legacy_key, deleted_at FROM appointments WHERE source = 'legacy' AND legacy_key IN (?IN)", rows.map((r) => r.key))).map((a) => [a.legacy_key, a]))
  const matched = rows.map((r) => ({ r, pet: find(r) }))
  // Rows imported before keys existed: claim them once by pet, day and time.
  const loose = group(await selectIn(env, "SELECT id, pet_id, day, time, status, legacy_status, legacy_info, legacy_key, deleted_at FROM appointments WHERE source = 'legacy' AND legacy_key IS NULL AND pet_id IN (?IN) ORDER BY id",
    matched.filter((m) => m.pet && !byKey.has(m.r.key)).map((m) => m.pet.id)), (a) => `${a.pet_id}|${a.day}|${a.time}`)
  const items = group(await selectIn(env, "SELECT appointment_id, name, detail FROM appointment_items WHERE deleted_at IS NULL AND added_by = 'Old system' AND appointment_id IN (?IN) ORDER BY id",
    [...byKey.values(), ...[...loose.values()].flat()].map((a) => a.id)), (i) => i.appointment_id)
  const sameItems = (a, b) => JSON.stringify(a.map((i) => [i.name, i.detail || null])) === JSON.stringify(b.map((i) => [i.name, i.detail || null]))
  // Two bookings for one pet at the same day and time: take the one whose status and services agree.
  const score = (a, r) => ((a.legacy_status ?? null) === r.legacyStatus ? 2 : 0) + ((a.legacy_info ?? null) === (r.info ?? null) ? 1 : 0) + (sameItems(items.get(a.id) || [], r.items) ? 2 : 0)
  const exOf = new Map()
  for (const m of matched) {
    let ex = byKey.get(m.r.key)
    if (!ex && m.pet) {
      const list = loose.get(`${m.pet.id}|${m.r.day}|${m.r.time}`) || []
      if (list.length) {
        const best = list.reduce((b, a) => (score(a, m.r) > score(b, m.r) ? a : b))
        list.splice(list.indexOf(best), 1)
        ex = best
      }
    }
    if (ex) exOf.set(m.r.key, ex)
  }
  const stmts = []
  for (const { r, pet } of matched) {
    const ex = exOf.get(r.key)
    if (!ex) {
      if (!pet) { flag(t, `${r.pet} · ${r.owner} · ${r.day} ${r.time}`, 'No pet with this owner and pet name in the app. Import owners and pets first, then this again.'); continue }
      if (pet.ambiguous) flag(t, `${r.pet} · ${r.owner} · ${r.day}`, 'Two customers share this owner and pet name: added to the first. Check it.')
      t.new++
      const { status, unclosed } = appStatus(r.legacyStatus, r.day, today)
      stmts.push(env.DB.prepare(`INSERT INTO appointments (pet_id, owner_id, day, time, starts_at, status, kind, source, booked_by_name, legacy_status, legacy_info, legacy_unclosed, legacy_key, cancel_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'legacy', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(pet.id, pet.ownerId, r.day, r.time, startsAt(r.day, r.time), status, r.info === 'Follow-up Appointment' ? 'follow_up' : 'booking', r.bookedBy, r.legacyStatus, r.info, unclosed, r.key, cancelReason(status, r.info), now))
      const sel = "SELECT id FROM appointments WHERE source = 'legacy' AND legacy_key = ?"
      for (const it of r.items) stmts.push(env.DB.prepare(`INSERT INTO appointment_items (appointment_id, name, detail, kind, added_by) SELECT id, ?, ?, 'service', 'Old system' FROM appointments WHERE source = 'legacy' AND legacy_key = ?`).bind(it.name, it.detail, r.key))
      stmts.push(env.DB.prepare(`INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) SELECT id, ?, NULL, status, 'import', ? FROM appointments WHERE id = (${sel})`).bind(now, ACTOR, r.key))
      continue
    }
    if (ex.deleted_at) { t.same++; continue }
    const writes = []
    if (!ex.legacy_key) writes.push(env.DB.prepare('UPDATE appointments SET legacy_key = ? WHERE id = ?').bind(r.key, ex.id))
    let changed = false
    const what = []
    if ((ex.legacy_status ?? null) !== r.legacyStatus || (ex.legacy_info ?? null) !== (r.info ?? null)) {
      changed = true
      what.push(`VetAssist status ${ex.legacy_status || '—'}${ex.legacy_info ? ` (${ex.legacy_info})` : ''} → ${r.legacyStatus}${r.info ? ` (${r.info})` : ''}`)
      const { status, unclosed } = appStatus(r.legacyStatus, r.day, today)
      writes.push(env.DB.prepare('UPDATE appointments SET status = ?, legacy_unclosed = ?, legacy_status = ?, legacy_info = ?, kind = ?, cancel_reason = ?, cancelled_at = CASE WHEN ? = \'cancelled\' THEN COALESCE(cancelled_at, ?) ELSE cancelled_at END, updated_at = ? WHERE id = ?')
        .bind(status, unclosed, r.legacyStatus, r.info, r.info === 'Follow-up Appointment' ? 'follow_up' : 'booking', cancelReason(status, r.info), status, now, now, ex.id))
      if (status !== ex.status) writes.push(env.DB.prepare(`INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) VALUES (?, ?, ?, ?, 'import', ?)`).bind(ex.id, now, ex.status, status, ACTOR))
    }
    if (!sameItems(items.get(ex.id) || [], r.items)) {
      changed = true
      const show = (l) => l.map((i) => [i.name, i.detail].filter(Boolean).join(' · ')).join(', ') || 'none'
      what.push(`services: ${show(items.get(ex.id) || [])} → ${show(r.items)}`)
      writes.push(env.DB.prepare("UPDATE appointment_items SET deleted_at = ?, deleted_by = ? WHERE appointment_id = ? AND added_by = 'Old system' AND deleted_at IS NULL").bind(now, ACTOR, ex.id))
      for (const it of r.items) writes.push(env.DB.prepare("INSERT INTO appointment_items (appointment_id, name, detail, kind, added_by) VALUES (?, ?, ?, 'service', 'Old system')").bind(ex.id, it.name, it.detail))
    }
    if (changed) { t.updated++; note(t, `${r.pet} · ${r.owner} · ${r.day} ${r.time}`, what.join('; ')) } else t.same++
    stmts.push(...writes)
  }
  if (apply) await run(env, stmts)
  return t
}

// After the last batch: link each "Rescheduled Appointment" to the cancelled "Has New Schedule" booking it
// replaced (nearest date, same pet), for rows not linked yet.
export async function finishAppointments(env) {
  const { results } = await env.DB.prepare(`SELECT id, pet_id, day, legacy_info, rescheduled_from,
      (SELECT name FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL ORDER BY id LIMIT 1) AS first_item
    FROM appointments a WHERE source = 'legacy' AND deleted_at IS NULL AND legacy_info IN ('Has New Schedule', 'Rescheduled Appointment')`).all()
  const taken = new Set(results.filter((a) => a.rescheduled_from).map((a) => a.rescheduled_from))
  const stmts = []
  for (const list of group(results, (a) => a.pet_id).values()) {
    const news = list.filter((a) => a.legacy_info === 'Rescheduled Appointment' && !a.rescheduled_from)
    const olds = list.filter((a) => a.legacy_info === 'Has New Schedule' && !taken.has(a.id)).sort((a, b) => a.day.localeCompare(b.day))
    for (const o of olds) {
      const dist = (n) => Math.abs(Date.parse(n.day) - Date.parse(o.day)) / 864e5 - (n.first_item === o.first_item ? 0.5 : 0)
      const pick = news.filter((n) => !n.linked).sort((a, b) => dist(a) - dist(b))[0]
      if (!pick) continue
      pick.linked = true
      stmts.push(env.DB.prepare('UPDATE appointments SET rescheduled_from = ? WHERE id = ? AND rescheduled_from IS NULL').bind(o.id, pick.id))
    }
  }
  await run(env, stmts)
  return { linked: stmts.length }
}

// ---------- Medical records (records.jsonl.gz) ----------
export async function syncRecords(env, rows, { apply }) {
  const t = tally()
  const now = new Date().toISOString()
  const seen = new Set()
  rows = rows.filter((r) => !seen.has(r.recordId) && seen.add(r.recordId))
  const find = await petFinder(env, rows.map((r) => ({ owner: r.owner.name, pet: r.pet.name, mobile: r.owner.mobile })))
  const have = new Map((await selectIn(env, "SELECT id, pet_id, day, kind, booking_only, legacy_record_id, legacy_file, deleted_at FROM medical_records WHERE source = 'legacy' AND legacy_record_id IN (?IN)", rows.map((r) => r.recordId))).map((m) => [m.legacy_record_id, m]))
  const entries = group(await selectIn(env, 'SELECT record_id, type, title, description, items, details, image_count FROM medical_entries WHERE deleted_at IS NULL AND record_id IN (?IN) ORDER BY record_id, sort', [...have.values()].map((m) => m.id)), (e) => e.record_id)
  const parse = (s) => { try { return s ? JSON.parse(s) : null } catch { return null } }
  const dbSignature = (m) => recordSignature({ day: m.day, kind: m.kind, bookingOnly: m.booking_only, entries: (entries.get(m.id) || []).map((e) => ({ type: e.type, title: e.title, description: e.description, items: parse(e.items) || [], details: parse(e.details), imageCount: e.image_count })) })
  const stmts = []
  const insertEntries = (r, recordSql, bind) => r.entries.forEach((e, i) => stmts.push(env.DB.prepare(`INSERT INTO medical_entries (record_id, pet_id, day, type, title, description, items, details, image_count, sort, created_at)
    SELECT id, pet_id, day, ?, ?, ?, ?, ?, ?, ?, ? FROM medical_records WHERE ${recordSql}`).bind(e.type, e.title, e.description, JSON.stringify(e.items), e.details ? JSON.stringify(e.details) : null, e.imageCount, i, now, ...bind)))
  const fills = new Map() // pet -> latest birthdate / address seen
  for (const r of rows) {
    const ex = have.get(r.recordId)
    const pet = ex ? null : find({ owner: r.owner.name, pet: r.pet.name, mobile: r.owner.mobile })
    const petId = ex?.pet_id || pet?.id
    if (petId) {
      const f = fills.get(petId) || { petId, ownerId: pet?.ownerId, day: '' }
      if (r.day >= f.day) Object.assign(f, { day: r.day, birthdate: r.pet.birthdate || f.birthdate, address: r.owner.address || f.address })
      fills.set(petId, f)
    }
    if (!ex) {
      if (!pet) { flag(t, `${r.pet.name} · ${r.owner.name} · ${r.day}`, 'No pet with this owner and pet name (or mobile) in the app. Import owners and pets first, then this again.'); continue }
      t.new++
      stmts.push(env.DB.prepare(`INSERT INTO medical_records (pet_id, owner_id, day, kind, booking_only, source, legacy_record_id, legacy_appointment_no, legacy_file, created_at)
        VALUES (?, ?, ?, ?, ?, 'legacy', ?, ?, ?, ?)`).bind(pet.id, pet.ownerId, r.day, r.kind, r.bookingOnly ? 1 : 0, r.recordId, r.apptNo, r.file, now))
      insertEntries(r, "source = 'legacy' AND legacy_record_id = ? AND deleted_at IS NULL", [r.recordId])
      continue
    }
    if (ex.deleted_at) { t.same++; continue }
    if (dbSignature(ex) === recordSignature(r)) {
      t.same++
      if (ex.legacy_file !== r.file) stmts.push(env.DB.prepare('UPDATE medical_records SET legacy_file = ? WHERE id = ?').bind(r.file, ex.id))
      continue
    }
    t.updated++
    note(t, `${r.pet.name} · ${r.owner.name} · ${r.day} (record ${r.recordId})`, `${(entries.get(ex.id) || []).length} entries → ${r.entries.length}; content changed`)
    stmts.push(env.DB.prepare('UPDATE medical_records SET day = ?, kind = ?, booking_only = ?, legacy_appointment_no = ?, legacy_file = ? WHERE id = ?').bind(r.day, r.kind, r.bookingOnly ? 1 : 0, r.apptNo, r.file, ex.id))
    stmts.push(env.DB.prepare('UPDATE medical_entries SET deleted_at = ?, deleted_by = ? WHERE record_id = ? AND deleted_at IS NULL').bind(now, ACTOR, ex.id))
    insertEntries(r, 'id = ?', [ex.id])
    // Photos stay on the record: point each at the new entry in the same position.
    stmts.push(env.DB.prepare(`UPDATE medical_images SET entry_id = (SELECT n.id FROM medical_entries n WHERE n.record_id = medical_images.record_id AND n.deleted_at IS NULL
        AND n.sort = (SELECT o.sort FROM medical_entries o WHERE o.id = medical_images.entry_id)) WHERE record_id = ? AND deleted_at IS NULL`).bind(ex.id))
  }
  for (const f of fills.values()) { // only where the app has none, as in the first import
    if (f.birthdate) stmts.push(env.DB.prepare('UPDATE pets SET birthdate = ?, updated_at = ? WHERE id = ? AND birthdate IS NULL').bind(f.birthdate, now, f.petId))
    if (f.address) stmts.push(env.DB.prepare("UPDATE owners SET address = ?, updated_at = ? WHERE id = (SELECT owner_id FROM pets WHERE id = ?) AND (address IS NULL OR address = '')").bind(f.address, now, f.petId))
  }
  if (apply) await run(env, stmts)
  return t
}

// After the last batch: link records to the pet's appointment that day, then settle bookings the old
// system left open (Completed when there's a real record that day, otherwise No Show).
export async function finishRecords(env) {
  const now = new Date().toISOString()
  const hasRecord = 'EXISTS (SELECT 1 FROM medical_records m WHERE m.pet_id = a.pet_id AND m.day = a.day AND m.deleted_at IS NULL AND m.booking_only = 0)'
  const today = manilaToday()
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE medical_records SET appointment_id = (SELECT a.id FROM appointments a WHERE a.pet_id = medical_records.pet_id AND a.day = medical_records.day AND a.deleted_at IS NULL AND a.status <> 'cancelled' ORDER BY a.id LIMIT 1)
      WHERE source = 'legacy' AND appointment_id IS NULL AND deleted_at IS NULL`),
    env.DB.prepare(`INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) SELECT a.id, ?, a.status, 'completed', 'import', ? FROM appointments a WHERE a.legacy_unclosed = 1 AND a.day < ? AND ${hasRecord}`).bind(now, ACTOR, today),
    env.DB.prepare(`UPDATE appointments SET status = 'completed', legacy_unclosed = 0, updated_at = ? WHERE id IN (SELECT a.id FROM appointments a WHERE a.legacy_unclosed = 1 AND a.day < ? AND ${hasRecord})`).bind(now, today),
    env.DB.prepare(`INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) SELECT a.id, ?, a.status, 'no_show', 'import', ? FROM appointments a WHERE a.legacy_unclosed = 1 AND a.day < ?`).bind(now, ACTOR, today),
    env.DB.prepare("UPDATE appointments SET status = 'no_show', legacy_unclosed = 0, updated_at = ? WHERE legacy_unclosed = 1 AND day < ?").bind(now, today),
  ])
  return { linked: res[0].meta.changes, completed: res[2].meta.changes, noShow: res[4].meta.changes }
}

// ---------- Record photos (photos.jsonl + uploaded.txt): link the ones already in storage ----------
export async function syncPhotos(env, rows, { apply }) {
  const t = tally()
  const have = new Set((await selectIn(env, 'SELECT key FROM medical_images WHERE key IN (?IN)', rows.map((p) => p.key))).map((r) => r.key))
  const stmts = []
  for (const p of rows) {
    if (have.has(p.key)) { t.same++; continue }
    t.new++
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO medical_images (record_id, entry_id, pet_id, key, content_type, bytes, width, height, sort, source)
      SELECT m.id, e.id, m.pet_id, ?, ?, ?, ?, ?, ?, 'legacy' FROM medical_records m JOIN medical_entries e ON e.record_id = m.id AND e.sort = ? AND e.deleted_at IS NULL
      WHERE m.source = 'legacy' AND m.legacy_file = ? AND m.deleted_at IS NULL LIMIT 1`).bind(p.key, p.type, p.bytes, p.width, p.height, p.n, p.entry, p.file))
  }
  if (apply) {
    await run(env, stmts)
    const linked = new Set((await selectIn(env, 'SELECT key FROM medical_images WHERE key IN (?IN)', rows.map((p) => p.key))).map((r) => r.key))
    for (const p of rows) if (!have.has(p.key) && !linked.has(p.key)) { t.new--; flag(t, p.key, 'Its medical record isn’t in the app yet. Import the medical records first, then this again.') }
  }
  return t
}

// ---------- Services and products: new ones only (what's set in the app stays) ----------
export async function syncServices(env, rows, { apply }) {
  const t = tally()
  const now = new Date().toISOString()
  const have = new Set((await selectIn(env, 'SELECT lower(name) AS n FROM services WHERE deleted_at IS NULL AND lower(name) IN (?IN)', rows.map((s) => s.name.toLowerCase()))).map((r) => r.n))
  const stmts = []
  for (const s of rows) {
    if (have.has(s.name.toLowerCase())) { t.same++; continue }
    t.new++
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO service_categories (name) VALUES (?)').bind(s.category))
    stmts.push(env.DB.prepare(`INSERT INTO services (name, description, price_cents, category_id, active, featured_online, created_at)
      SELECT ?, ?, ?, (SELECT id FROM service_categories WHERE name = ? COLLATE NOCASE), ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL)`)
      .bind(s.name, s.description, s.priceCents, s.category, s.active, s.featuredOnline, now, s.name))
    s.variations.forEach((v, i) => stmts.push(env.DB.prepare(`INSERT INTO service_variations (service_id, name, description, price_cents, sort)
      SELECT id, ?, ?, ?, ? FROM services WHERE name = ? COLLATE NOCASE AND created_at = ? AND deleted_at IS NULL`).bind(v.name, v.description, v.priceCents, i, s.name, now)))
  }
  if (apply) await run(env, stmts)
  return t
}
export async function syncProducts(env, rows, { apply }) {
  const t = tally()
  const have = new Set((await selectIn(env, 'SELECT lower(name) AS n FROM products WHERE branch_id = 1 AND deleted_at IS NULL AND lower(name) IN (?IN)', rows.map((p) => p.name.toLowerCase()))).map((r) => r.n))
  const stmts = []
  for (const p of rows) {
    if (have.has(p.name.toLowerCase())) { t.same++; continue }
    t.new++
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO products (branch_id, name, category, source) VALUES (1, ?, ?, 'inventory')").bind(p.name, p.category))
    if (p.priceCents != null || p.costCents != null) stmts.push(env.DB.prepare('UPDATE products SET price_cents = COALESCE(price_cents, ?), cost_cents = COALESCE(cost_cents, ?) WHERE branch_id = 1 AND name = ? COLLATE NOCASE AND deleted_at IS NULL').bind(p.priceCents, p.costCents, p.name))
  }
  if (apply) await run(env, stmts)
  return t
}
