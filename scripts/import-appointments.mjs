// Turns the scraped Appointments list (tools/medical-records-download/appointments.mjs) into SQL.
//
//   npm run import:appointments -- --appointments path/to/appointments.jsonl --pets path/to/masterlist_pets.csv
//
// Writes, into data/ (git-ignored, because it holds client details):
//   data/import-appointments.sql        -> npx wrangler d1 execute hanna-clinic --local --file data/import-appointments.sql
//                                          (then --remote for the real database)
//   data/import-appointments-report.md  -> what was matched, merged and left out
//
// Safe to run again: it first removes the appointments an earlier run imported (source = 'legacy')
// with their items and history. Appointments booked in the new app are never touched.
//
// How old rows become new ones (today = the day of the import, Manila):
//   Cancelled, Completed               -> the same
//   Arrived / Started / Dispense / Inpatient, before today -> Completed (the old system never closed them)
//   Pending / Accepted, today or later -> Accepted
//   Pending / Accepted, before today   -> kept as they were, marked "left open in the old system"
//                                         (legacy_unclosed). The medical records import decides later
//                                         whether each visit happened (Completed) or not (No Show).
// Pets are matched by the owner's name and the pet's name against the pets masterlist, then found
// in the database by customer number + pet name.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
if (!args.appointments || !args.pets) {
  console.error('Usage: npm run import:appointments -- --appointments <appointments.jsonl> --pets <masterlist_pets.csv> [--today YYYY-MM-DD]')
  process.exit(1)
}
const TODAY = args.today || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

// --- CSV (same rules as import-legacy.mjs) ---
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  text = text.replace(/^﻿/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim()))
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}
const tidy = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const low = (v) => tidy(v).toLowerCase()

// --- Pets masterlist: (owner name, pet name) -> customer number(s) ---
const petIndex = new Map()
for (const p of parseCsv(readFileSync(args.pets, 'utf8'))) {
  const key = `${low(p['Owner Name'])}|${low(p['Pet Name'])}`
  const list = petIndex.get(key) || []
  if (!list.includes(p['Customer Number'])) list.push(p['Customer Number'])
  petIndex.set(key, list)
}

// --- Appointments ---
const raw = []
const seenSeq = new Set()
for (const line of readFileSync(args.appointments, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let r
  try { r = JSON.parse(line) } catch { continue }
  if (seenSeq.has(r.seq)) continue
  seenSeq.add(r.seq)
  raw.push(r)
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
function day(text) { // "Sep. 28, 2037" -> 2037-09-28
  const m = String(text).match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/)
  if (!m || !MONTHS[m[1].toLowerCase()]) return null
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}
function time(text) { // "10:00 AM" -> 10:00
  const m = String(text).match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}
function infoTitle(info) { // "Has New ScheduleThis appointment…" / "Has New Schedule | This…" -> "Has New Schedule"
  const t = tidy(info)
  if (!t) return null
  for (const title of ['Missed Vaccination', 'Has New Schedule', 'Rescheduled Appointment', 'Follow-up Appointment', 'Cancelled: Deceased Pet']) if (t.startsWith(title)) return title
  return t.split(' | ')[0].slice(0, 120)
}

// Services: the visible cell, plus what "+1 more" / "2 packages" showed on hover.
const knownCategories = new Set()
for (const r of raw) if (r.services?.[0] && r.services[0] !== 'No services') knownCategories.add(tidy(r.services[0]))
for (const r of raw) {
  const m = (r.moreText || '').match(/^All Services: \|(.*)$/)
  if (m) m[1].split(' | ').map(tidy).filter((t) => t && !t.startsWith('Packages:')).forEach((t) => knownCategories.add(t))
}
const categoriesBySize = [...knownCategories].sort((a, b) => b.length - a.length)
function items(r) {
  const vis = (r.services || []).map(tidy).filter(Boolean)
  if (!vis.length || vis[0] === 'No services') return []
  const more = tidy(r.moreText)
  const pkgs = (s) => s.split(',').map(tidy).filter(Boolean)
  if (more.startsWith('All Services: |')) { // "All Services: | VACCINE | Packages: FLUVACCINE | DOG CASTRATION"
    const out = []
    for (const t of more.slice('All Services: |'.length).split(' | ').map(tidy).filter(Boolean)) {
      if (t.startsWith('Packages:')) {
        const last = out[out.length - 1]
        const list = pkgs(t.slice(9))
        if (last && !last.detail) { last.detail = list[0]; list.slice(1).forEach((d) => out.push({ name: last.name, detail: d })) }
        else list.forEach((d) => out.push({ name: last?.name || vis[0], detail: d }))
      } else out.push({ name: t, detail: null })
    }
    return out
  }
  if (more.startsWith('All Services:')) { // run together: "DEWORMPackages: DW 1-10KGVACCINEPackages: FLUVACCINE"
    const parts = more.slice('All Services:'.length).split('Packages: ')
    const out = []
    let name = parts.shift()
    for (let i = 0; i < parts.length; i++) {
      let chunk = parts[i]
      let next = null
      if (i < parts.length - 1) {
        const cat = categoriesBySize.find((c) => chunk.endsWith(c) && chunk.length > c.length)
        if (cat) { next = cat; chunk = chunk.slice(0, -cat.length) }
      }
      out.push({ name: tidy(name), detail: tidy(chunk) || null })
      name = next || name
    }
    return out.length ? out : [{ name: vis[0], detail: null }]
  }
  if (more.startsWith('Packages:')) { // "Packages: | 6 IN 1 , ANTI RABIES" for the category shown
    return pkgs(more.replace(/^Packages:\s*\|?/, '')).map((d) => ({ name: vis[0], detail: d }))
  }
  const detail = vis[1] && !/^\d+\s+packages?$/i.test(vis[1]) ? vis[1] : null
  return [{ name: vis[0], detail }]
}

// --- Build rows ---
const report = { unmatched: [], ambiguous: [], duplicates: 0, badDate: [], farFuture: [], open: 0, closed: 0, linked: 0, unlinked: 0 }
const rows = []
const fingerprint = new Set()
for (const r of raw) {
  const d = day(r.date)
  const t = time(r.time)
  if (!d || !t) { report.badDate.push(r); continue }
  const fp = JSON.stringify([low(r.pet), low(r.owner), d, t, r.status, r.services, r.moreText || '', r.info || '', r.bookedBy])
  if (fingerprint.has(fp)) { report.duplicates++; continue }
  fingerprint.add(fp)
  const nos = petIndex.get(`${low(r.owner)}|${low(r.pet)}`)
  if (!nos) { report.unmatched.push(r); continue }
  if (nos.length > 1) report.ambiguous.push({ r, nos })
  const info = infoTitle(r.info)
  const L = tidy(r.status)
  let status = { Cancelled: 'cancelled', Completed: 'completed', Accepted: 'accepted', Pending: 'pending', Arrived: 'arrived', Started: 'started', Dispense: 'dispense', Inpatient: 'inpatient' }[L] || 'accepted'
  let unclosed = 0
  if (['arrived', 'started', 'dispense', 'inpatient'].includes(status) && d < TODAY) { status = 'completed'; report.closed++ }
  if (['pending', 'accepted'].includes(status)) {
    if (d >= TODAY) status = 'accepted'
    else { unclosed = 1; report.open++ }
  }
  if (d > `${Number(TODAY.slice(0, 4)) + 3}-12-31`) report.farFuture.push(r)
  const cancelReason = status !== 'cancelled' ? null
    : info === 'Cancelled: Deceased Pet' ? 'Pet passed away'
      : info === 'Has New Schedule' ? 'Rescheduled' : 'Cancelled in the old system'
  const booked = tidy(r.bookedBy)
  rows.push({
    ref: r.seq, customerNo: nos[0], pet: tidy(r.pet), day: d, time: t, status, unclosed, legacyStatus: L, info,
    kind: info === 'Follow-up Appointment' ? 'follow_up' : 'booking',
    bookedBy: /^\+\d+$/.test(booked) ? null : booked || null,
    cancelReason, items: items(r), petKey: `${nos[0]}|${low(r.pet)}`,
  })
}

// Reschedules: each cancelled "Has New Schedule" row is linked to the nearest-dated "Rescheduled
// Appointment" of the same pet that isn't linked yet (same first service preferred).
const byPet = new Map()
for (const row of rows) (byPet.get(row.petKey) || byPet.set(row.petKey, []).get(row.petKey)).push(row)
const links = []
for (const list of byPet.values()) {
  const olds = list.filter((x) => x.info === 'Has New Schedule').sort((a, b) => a.day.localeCompare(b.day))
  const news = list.filter((x) => x.info === 'Rescheduled Appointment')
  for (const o of olds) {
    const dist = (n) => Math.abs(Date.parse(n.day) - Date.parse(o.day)) / 864e5 - (n.items[0]?.name === o.items[0]?.name ? 0.5 : 0)
    const pick = news.filter((n) => !n.linked && n.ref !== o.ref).sort((a, b) => dist(a) - dist(b))[0]
    if (pick) { pick.linked = true; links.push([pick.ref, o.ref]); report.linked++ } else report.unlinked++
  }
}

// --- SQL ---
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const startsAt = (d, t) => new Date(`${d}T${t}:00+08:00`).toISOString()
rows.sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time) || b.ref - a.ref)
const now = new Date().toISOString()
const legacy = "SELECT id FROM appointments WHERE source = 'legacy'"
const sql = [
  `-- Generated by scripts/import-appointments.mjs on ${now} (today = ${TODAY}). Contains client details: never commit.`,
  `DELETE FROM appointment_events WHERE appointment_id IN (${legacy});`,
  `DELETE FROM appointment_items WHERE appointment_id IN (${legacy});`,
  `DELETE FROM appointment_staff WHERE appointment_id IN (${legacy});`,
  `DELETE FROM appointment_notes WHERE appointment_id IN (${legacy});`,
  "UPDATE appointments SET rescheduled_from = NULL WHERE source = 'legacy';",
  "DELETE FROM appointments WHERE source = 'legacy';",
]
for (const r of rows) {
  sql.push(`INSERT INTO appointments (pet_id, owner_id, day, time, starts_at, status, kind, source, booked_by_name, legacy_status, legacy_info, legacy_unclosed, legacy_ref, cancel_reason, created_at)
SELECT p.id, p.owner_id, ${q(r.day)}, ${q(r.time)}, ${q(startsAt(r.day, r.time))}, ${q(r.status)}, ${q(r.kind)}, 'legacy', ${q(r.bookedBy)}, ${q(r.legacyStatus)}, ${q(r.info)}, ${r.unclosed}, ${r.ref}, ${q(r.cancelReason)}, ${q(now)}
FROM pets p JOIN owners o ON o.id = p.owner_id WHERE o.customer_no = ${q(r.customerNo)} AND p.name = ${q(r.pet)} COLLATE NOCASE ORDER BY p.deleted_at IS NOT NULL, p.id LIMIT 1;`)
}
const byRef = (ref) => `(SELECT id FROM appointments WHERE source = 'legacy' AND legacy_ref = ${ref})`
for (const r of rows) {
  for (const it of r.items) {
    sql.push(`INSERT INTO appointment_items (appointment_id, name, detail, kind, added_by) SELECT id, ${q(it.name)}, ${q(it.detail)}, 'service', 'Old system' FROM appointments WHERE source = 'legacy' AND legacy_ref = ${r.ref};`)
  }
}
sql.push(`INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) SELECT id, ${q(now)}, NULL, status, 'import', 'Old system' FROM appointments WHERE source = 'legacy';`)
for (const [newRef, oldRef] of links) sql.push(`UPDATE appointments SET rescheduled_from = ${byRef(oldRef)} WHERE source = 'legacy' AND legacy_ref = ${newRef};`)
sql.push(`INSERT INTO audit_log (actor, action, entity, detail) VALUES ('import', 'legacy_import', 'appointments', ${q(JSON.stringify({ appointments: rows.length, today: TODAY }))});`, '')

mkdirSync('data', { recursive: true })
writeFileSync('data/import-appointments.sql', sql.join('\n'))

// --- Report ---
const count = (k) => rows.filter((r) => r.status === k).length
const line = (r) => `${r.pet} · ${r.owner} · ${r.date} ${r.time} · ${r.status}`
writeFileSync('data/import-appointments-report.md', `# Appointments import report

Generated ${now} (today = ${TODAY}) from \`${args.appointments.split(/[\\/]/).pop()}\`. Contains client details: keep it out of git.

| | Count |
|---|---|
| Rows in the scraped list | ${raw.length} |
| Exact duplicates merged | ${report.duplicates} |
| Imported | ${rows.length} |
| Not matched to a pet (left out) | ${report.unmatched.length} |
| Accepted (upcoming) | ${rows.filter((r) => r.status === 'accepted' && !r.unclosed).length} |
| Left open in the old system (past Pending/Accepted) | ${report.open} |
| Completed | ${count('completed')} (of which ${report.closed} were Arrived/Started/Dispense and never closed) |
| Cancelled | ${count('cancelled')} |
| Reschedules linked to their new appointment | ${report.linked} (not found: ${report.unlinked}) |
| Services and packages | ${rows.reduce((n, r) => n + r.items.length, 0)} |

## Not matched to a pet (${report.unmatched.length})
Probably pets added after the masterlist export. Add them, re-export, and run again.
${report.unmatched.map((r) => `- ${line(r)}`).join('\n') || '- none'}

## Owner and pet name shared by more than one customer (${report.ambiguous.length})
Imported to the first customer number; check them.
${report.ambiguous.map(({ r, nos }) => `- ${line(r)} → ${nos.join(', ')}`).join('\n') || '- none'}

## Dates more than three years ahead (${report.farFuture.length})
${report.farFuture.map((r) => `- ${line(r)}`).join('\n') || '- none'}

## Unreadable date or time (${report.badDate.length})
${report.badDate.map((r) => `- ${line(r)}`).join('\n') || '- none'}
`)

console.log(`Imported ${rows.length} of ${raw.length} appointments (${report.duplicates} duplicates merged, ${report.unmatched.length} not matched).
Linked ${report.linked} reschedules. ${report.open} past bookings were left open in the old system.
Wrote data/import-appointments.sql and data/import-appointments-report.md`)
