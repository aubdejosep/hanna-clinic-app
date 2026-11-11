// Turns the medical records read on the clinic PC (tools/medical-records-download/records.mjs)
// into SQL for the clinic database.
//
//   npm run import:records -- --records data/records.jsonl.gz --owners <masterlist_owners.csv> --pets <masterlist_pets.csv>
//
// Writes, into data/ (git-ignored: medical and client details):
//   data/import-records.sql         -> npx wrangler d1 execute hanna-clinic --local --file data/import-records.sql (then --remote)
//   data/import-records-report.md   -> what was matched, skipped and filled in
//
// Run it after the appointments import. It:
//   * adds every record with its entries (Note, Vaccination, Diagnosis, Treatment Plan), leaving out the
//     old system's automatic "Auto-generated note record" made when a booking was created, and records
//     holding nothing but an automatic vaccine placeholder (a booking, not a vaccination);
//   * fills in birthdates and owner addresses the app doesn't have yet (never overwrites);
//   * settles the bookings the old system left open: Completed when the pet has a record that day,
//     otherwise No Show;
//   * links each record to the pet's appointment that day, if there is one.
// Safe to run again: it first removes what an earlier run imported (source = 'legacy').

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
if (!args.records || !args.pets || !args.owners) {
  console.error('Usage: npm run import:records -- --records <records.jsonl(.gz)> --owners <masterlist_owners.csv> --pets <masterlist_pets.csv>')
  process.exit(1)
}

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
const strip = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g, '') // stray control characters from the PDFs
const tidy = (v) => strip(v).replace(/\s+/g, ' ').trim()
const low = (v) => tidy(v).toLowerCase()
const mobile = (v) => { const m = String(v || '').replace(/[^\d+]/g, '').match(/^(?:\+?63|0)?(9\d{9})$/); return m ? m[1] : null }
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 }
function iso(text) { // "March 07, 2023" -> 2023-03-07
  const m = String(text || '').match(/^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/)
  const mo = m && (MONTHS[m[1].toLowerCase()] || Object.entries(MONTHS).find(([k]) => k.startsWith(m[1].toLowerCase().slice(0, 3)))?.[1])
  return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}

// --- Masterlist: who is who ---
const owners = parseCsv(readFileSync(args.owners, 'utf8'))
const pets = parseCsv(readFileSync(args.pets, 'utf8'))
const byOwnerPet = new Map()   // "owner|pet" -> [{no, pet}]
const petsByNo = new Map()     // customer no -> [pet names]
for (const p of pets) {
  const no = p['Customer Number']
  const key = `${low(p['Owner Name'])}|${low(p['Pet Name'])}`
  ;(byOwnerPet.get(key) || byOwnerPet.set(key, []).get(key)).push({ no, pet: tidy(p['Pet Name']) })
  ;(petsByNo.get(no) || petsByNo.set(no, []).get(no)).push(tidy(p['Pet Name']))
}
const noByPhone = new Map()
for (const o of owners) {
  const m = mobile(o.Phone)
  if (m) (noByPhone.get(m) || noByPhone.set(m, []).get(m)).push(o['Customer Number'])
}
function match(r) {
  const direct = byOwnerPet.get(`${low(r.owner?.name)}|${low(r.pet?.name)}`)
  if (direct?.length) return { ...direct[0], how: direct.length > 1 ? 'name (ambiguous)' : 'name' }
  const phone = mobile(r.owner?.phone) || mobile(String(r.zip).split('-').pop()?.replace(/\.zip$/i, ''))
  for (const no of noByPhone.get(phone) || []) {
    const pet = (petsByNo.get(no) || []).find((n) => low(n) === low(r.pet?.name))
    if (pet) return { no, pet, how: 'phone' }
  }
  return null
}

// --- Records ---
const raw = readFileSync(args.records)
const text = args.records.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l))

const AUTO = 'This note was automatically created'
const isAuto = (e) => e.type === 'NOTE' && /^auto-generated note record$/i.test(tidy(e.title)) && String(e.description || '').startsWith(AUTO)
// "Vaccination record auto-created from booked/added service: X. Please update…": a placeholder the old
// system made for a booked or added vaccine. Kept only inside a record that has something real.
const PLACEHOLDER = /^Vaccination record auto-created from (booked|added) service/i
const isPlaceholder = (e) => e.type === 'VACCINATION' && PLACEHOLDER.test(String(e.description || ''))
const TYPE = { NOTE: 'note', VACCINATION: 'vaccination', DIAGNOSIS: 'diagnosis', 'TREATMENT PLAN': 'treatment_plan', PRESCRIPTION: 'prescription' }

function shapeEntry(e) {
  let title = tidy(e.title)
  const details = {}
  const plan = title.match(/^(.*?)\s+(ACTIVE|COMPLETED|CANCELLED|ON HOLD|PAUSED|INACTIVE)\s+Priority:\s*(\w+)$/i)
  if (plan) { title = plan[1]; details.status = plan[2].toLowerCase(); details.priority = plan[3].toLowerCase() }
  let into = null
  for (const o of e.other || []) {
    const t = tidy(o.text)
    if (/^Assigned:/i.test(t)) { details.assigned = t.replace(/^Assigned:\s*/i, ''); continue }
    if (/^ASSIGNED VETERINARIAN/.test(o.section)) { details.vet = t; continue }
    if (/^Treatment Objectives$/i.test(t)) { into = 'objectives'; continue }
    if (/^Treatment Protocol$/i.test(t)) { into = 'protocol'; continue }
    if (/^START DATE/.test(o.section) && !into) {
      const dates = t.match(/[A-Z][a-z]+ \d{1,2}, \d{4}/g) || []
      if (dates[0]) details.start = iso(dates[0])
      if (dates[1]) details.targetEnd = iso(dates[1])
      continue
    }
    if (into) details[into] = details[into] ? `${details[into]}\n${t}` : t
    else details.other = details.other ? `${details.other}\n${t}` : t
  }
  return {
    type: TYPE[tidy(e.type).toUpperCase()] || 'other',
    title: title || null,
    description: PLACEHOLDER.test(String(e.description || '')) ? null : strip(e.description).trim() || null,
    items: (e.items || []).map((i) => ({ kind: i.kind, name: tidy(i.name), detail: tidy(i.detail) || null, qty: i.qty || 1, ...(i.notes && !/^Booked as part of the appointment/i.test(i.notes) ? { notes: tidy(i.notes) } : {}) })),
    details: Object.keys(details).length ? details : null,
    imageCount: e.imageCount || 0,
  }
}

const report = { placeholdersKept: 0, pdfs: rows.length, errors: 0, autoOnly: 0, empty: 0, unmatched: [], ambiguous: 0, byPhone: 0, records: 0, entries: 0, types: {}, images: 0 }
const records = []
const latestByPet = new Map() // pet key -> {day, birthdate, address, no}
rows.forEach((r, idx) => {
  if (r.error) { report.errors++; return }
  const real = (r.entries || []).filter((e) => !isAuto(e) && !isPlaceholder(e))
  const kept = real.length ? (r.entries || []).filter((e) => !isAuto(e)) : []
  if (!kept.length) { if ((r.entries || []).length) report.autoOnly++; else report.empty++; return }
  report.placeholdersKept += kept.filter(isPlaceholder).length
  const day = iso(r.date)
  const m = match(r)
  if (!m || !day) { report.unmatched.push(r); return }
  if (m.how === 'name (ambiguous)') report.ambiguous++
  if (m.how === 'phone') report.byPhone++
  const entries = kept.map(shapeEntry)
  records.push({ ref: idx + 1, no: m.no, pet: m.pet, day, kind: r.kind === 'appointment' ? 'visit' : 'record', recordId: r.recordId, apptNo: r.appointmentNo === 'Standalone' ? null : r.appointmentNo, file: `${r.zip}/${r.file}`, entries })
  report.records++
  report.entries += entries.length
  for (const e of entries) { report.types[e.type] = (report.types[e.type] || 0) + 1; report.images += e.imageCount }
  const key = `${m.no}|${low(m.pet)}`
  const prev = latestByPet.get(key)
  if (!prev || day > prev.day) latestByPet.set(key, { day, no: m.no, pet: m.pet, birthdate: iso(r.pet?.birthdate), address: tidy(r.owner?.address) || null })
  else {
    if (!prev.birthdate && iso(r.pet?.birthdate)) prev.birthdate = iso(r.pet.birthdate)
    if (!prev.address && tidy(r.owner?.address)) prev.address = tidy(r.owner.address)
  }
})

// --- SQL ---
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const now = new Date().toISOString()
const petSel = (no, pet) => `FROM pets p JOIN owners o ON o.id = p.owner_id WHERE o.customer_no = ${q(no)} AND p.name = ${q(pet)} COLLATE NOCASE ORDER BY p.deleted_at IS NOT NULL, p.id LIMIT 1`
const sql = [
  `-- Generated by scripts/import-records.mjs on ${now}. Contains medical and client details: never commit.`,
  "DELETE FROM medical_entries WHERE record_id IN (SELECT id FROM medical_records WHERE source = 'legacy');",
  "DELETE FROM medical_records WHERE source = 'legacy';",
]
records.sort((a, b) => a.day.localeCompare(b.day) || a.ref - b.ref)
for (const r of records) {
  sql.push(`INSERT INTO medical_records (pet_id, owner_id, day, kind, source, legacy_record_id, legacy_appointment_no, legacy_ref, legacy_file, created_at)
SELECT p.id, p.owner_id, ${q(r.day)}, ${q(r.kind)}, 'legacy', ${q(r.recordId)}, ${q(r.apptNo)}, ${r.ref}, ${q(r.file)}, ${q(now)} ${petSel(r.no, r.pet)};`)
  r.entries.forEach((e, i) => {
    sql.push(`INSERT INTO medical_entries (record_id, pet_id, day, type, title, description, items, details, image_count, sort, created_at)
SELECT id, pet_id, day, ${q(e.type)}, ${q(e.title)}, ${q(e.description)}, ${q(JSON.stringify(e.items))}, ${q(e.details ? JSON.stringify(e.details) : null)}, ${e.imageCount}, ${i}, ${q(now)} FROM medical_records WHERE source = 'legacy' AND legacy_ref = ${r.ref};`)
  })
}
let birthdates = 0
let addresses = 0
for (const p of latestByPet.values()) {
  if (p.birthdate) { birthdates++; sql.push(`UPDATE pets SET birthdate = ${q(p.birthdate)}, updated_at = ${q(now)} WHERE birthdate IS NULL AND id = (SELECT p.id ${petSel(p.no, p.pet)});`) }
  if (p.address) { addresses++; sql.push(`UPDATE owners SET address = ${q(p.address)}, updated_at = ${q(now)} WHERE (address IS NULL OR address = '') AND customer_no = ${q(p.no)};`) }
}
// Link records to the pet's appointment that day, then settle the bookings left open in the old system.
const hasRecord = "EXISTS (SELECT 1 FROM medical_records m WHERE m.pet_id = a.pet_id AND m.day = a.day AND m.deleted_at IS NULL)"
sql.push(
  `UPDATE medical_records SET appointment_id = (SELECT a.id FROM appointments a WHERE a.pet_id = medical_records.pet_id AND a.day = medical_records.day AND a.deleted_at IS NULL AND a.status <> 'cancelled' ORDER BY a.id LIMIT 1) WHERE source = 'legacy';`,
  `INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) SELECT a.id, ${q(now)}, a.status, 'completed', 'import', 'Medical records import' FROM appointments a WHERE a.legacy_unclosed = 1 AND ${hasRecord};`,
  `UPDATE appointments SET status = 'completed', legacy_unclosed = 0, updated_at = ${q(now)} WHERE id IN (SELECT a.id FROM appointments a WHERE a.legacy_unclosed = 1 AND ${hasRecord});`,
  `INSERT INTO appointment_events (appointment_id, at, from_status, to_status, via, actor) SELECT a.id, ${q(now)}, a.status, 'no_show', 'import', 'Medical records import' FROM appointments a WHERE a.legacy_unclosed = 1;`,
  `UPDATE appointments SET status = 'no_show', legacy_unclosed = 0, updated_at = ${q(now)} WHERE legacy_unclosed = 1;`,
  `INSERT INTO audit_log (actor, action, entity, detail) VALUES ('import', 'legacy_import', 'medical_records', ${q(JSON.stringify({ records: report.records, entries: report.entries }))});`,
  '',
)
mkdirSync('data', { recursive: true })
writeFileSync('data/import-records.sql', sql.join('\n'))

const line = (r) => `${r.pet?.name} · ${r.owner?.name} · ${r.owner?.phone} · ${r.date} · ${r.file}`
writeFileSync('data/import-records-report.md', `# Medical records import report

Generated ${now} from \`${args.records.split(/[\\/]/).pop()}\`. Contains medical and client details: keep it out of git.

| | Count |
|---|---|
| PDFs read on the clinic PC | ${report.pdfs} |
| Only the old system's automatic booking notes and vaccine placeholders (left out) | ${report.autoOnly} |
| Vaccine placeholders kept because the record has real entries (text dropped, vaccine kept) | ${report.placeholdersKept} |
| Empty ("No medical records found") | ${report.empty} |
| Couldn't be read | ${report.errors} |
| Not matched to a pet (left out) | ${report.unmatched.length} |
| Records imported | ${report.records} (matched by phone: ${report.byPhone}; owner + pet name shared by two customers: ${report.ambiguous}) |
| Entries | ${report.entries} ${JSON.stringify(report.types)} |
| Images (still on the clinic PC) | ${report.images} |
| Pets given a birthdate (only where the app had none) | up to ${birthdates} |
| Owners given an address (only where the app had none) | up to ${addresses} |

## Not matched to a pet (${report.unmatched.length})
Usually pets added after the masterlist export, or renamed since.
${report.unmatched.map((r) => `- ${line(r)}`).join('\n') || '- none'}
`)
console.log(`${report.records} records with ${report.entries} entries ${JSON.stringify(report.types)}.
Left out: ${report.autoOnly} automatic booking notes, ${report.empty} empty, ${report.unmatched.length} not matched to a pet.
Wrote data/import-records.sql and data/import-records-report.md`)
