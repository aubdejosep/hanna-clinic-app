// Turns the old system's owner and pet exports into SQL for the clinic database.
//
//   npm run import:legacy -- --owners path/to/masterlist_owners.csv --pets path/to/masterlist_pets.csv
//
// Writes, into data/ (git-ignored, because it holds client details):
//   data/import.sql         -> load with: npx wrangler d1 execute hanna-clinic --local  --file data/import.sql
//                                        (then --remote for the real database, once)
//   data/import-report.md   -> what was cleaned up and which records staff should review
//
// Run it on an empty database: owners and pets keep fixed ids so pets can point at their owners,
// and a second run stops on the first duplicate instead of doubling the data.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { standardBreed } from './breeds.mjs'

// --- Arguments ---
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
if (!args.owners || !args.pets) {
  console.error('Usage: npm run import:legacy -- --owners <owners.csv> --pets <pets.csv>')
  process.exit(1)
}

// --- CSV (quoted fields, commas and newlines inside quotes, BOM) ---
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

// --- Cleaning ---
const BLANK = new Set(['', '—', '-', 'n/a', 'na', 'none'])
const blank = (v) => BLANK.has(String(v ?? '').trim().toLowerCase())
const tidy = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

function mobile(raw) { // -> +639XXXXXXXXX or null (same rule as the website's normalizeMobile)
  const m = String(raw || '').replace(/[^\d+]/g, '').match(/^(?:\+?63|0)?(9\d{9})$/)
  return m ? `+63${m[1]}` : null
}
function realEmail(raw) { // the old system invented vpnoemailN@gmail.com for owners without one
  const e = String(raw || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || /noemail/.test(e)) return null
  return e
}
function isoDay(raw) {
  const s = String(raw || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}
function microchip(raw) { // ="900085001646620" -> 900085001646620
  const s = String(raw || '').replace(/^="?|"$/g, '').replace(/\s/g, '')
  return blank(s) ? null : s
}
const SPECIES = { dog: 'dog', cat: 'cat' }
const SEX = { male: 'male', female: 'female' }

// --- Read ---
const ownerRows = parseCsv(readFileSync(args.owners, 'utf8'))
const petRows = parseCsv(readFileSync(args.pets, 'utf8'))
const today = new Date().toISOString().slice(0, 10)

// --- Owners ---
const owners = ownerRows.map((r, i) => {
  const raw = tidy(r.Phone)
  const m = mobile(raw)
  return {
    id: i + 1,
    customer_no: tidy(r['Customer Number']),
    full_name: tidy(r.Name),
    mobile: m,
    mobile_raw: !m && !blank(raw) ? raw : null,
    email: realEmail(r.Email),
    vip: /^yes$/i.test(tidy(r.VIP)) ? 1 : 0,
    legacy_added_on: isoDay(r['Date Added']),
    flags: [],
  }
})
const byPhone = new Map()
const byName = new Map()
for (const o of owners) {
  if (!o.mobile && !o.mobile_raw) o.flags.push('no_phone')
  if (o.mobile_raw) o.flags.push('check_phone')
  if (o.mobile) byPhone.set(o.mobile, [...(byPhone.get(o.mobile) || []), o])
  const key = o.full_name.toLowerCase()
  byName.set(key, [...(byName.get(key) || []), o])
}
for (const group of byPhone.values()) if (group.length > 1) group.forEach((o) => o.flags.push('shared_phone'))
for (const group of byName.values()) if (group.length > 1) group.forEach((o) => o.flags.push('same_name'))
const ownerByNo = new Map(owners.map((o) => [o.customer_no, o]))

// --- Pets ---
const orphans = []
const breedChanges = new Map()
const pets = []
for (const r of petRows) {
  const owner = ownerByNo.get(tidy(r['Customer Number']))
  if (!owner) { orphans.push(tidy(r['Customer Number'])); continue }
  const { breed, changed } = standardBreed(r.Breed)
  if (changed) breedChanges.set(`${tidy(r.Breed)} → ${breed ?? '(blank)'}`, (breedChanges.get(`${tidy(r.Breed)} → ${breed ?? '(blank)'}`) || 0) + 1)
  const birth = isoDay(r.Birthdate)
  pets.push({
    id: pets.length + 1,
    owner_id: owner.id,
    owner_no: owner.customer_no,
    name: tidy(r['Pet Name']),
    species: SPECIES[tidy(r.Species).toLowerCase()] || 'other',
    breed,
    breed_raw: changed && !blank(r.Breed) ? tidy(r.Breed) : null,
    sex: SEX[tidy(r.Gender).toLowerCase()] || 'unknown',
    birthdate: birth && birth <= today ? birth : null,
    microchip: microchip(r['Microchip Number']),
    legacy_added_on: isoDay(r['Date Added']),
    flags: [],
  })
}
const petKey = new Map()
for (const p of pets) {
  const key = `${p.owner_id}:${p.name.toLowerCase()}`
  petKey.set(key, [...(petKey.get(key) || []), p])
}
for (const group of petKey.values()) if (group.length > 1) group.forEach((p) => p.flags.push('same_name_same_owner'))

// --- SQL ---
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
function inserts(table, cols, rows) {
  const out = []
  for (let i = 0; i < rows.length; i += 100) {
    const values = rows.slice(i, i + 100).map((r) => `(${cols.map((c) => q(r[c])).join(', ')})`)
    out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${values.join(',\n')};`)
  }
  return out.join('\n')
}
for (const o of owners) { o.review_flags = JSON.stringify(o.flags); o.source = 'legacy' }
for (const p of pets) p.review_flags = JSON.stringify(p.flags)

const sql = [
  `-- Generated by scripts/import-legacy.mjs on ${new Date().toISOString()}. Contains client details: never commit.`,
  inserts('owners', ['id', 'customer_no', 'full_name', 'mobile', 'mobile_raw', 'email', 'vip', 'source', 'legacy_added_on', 'review_flags'], owners),
  inserts('pets', ['id', 'owner_id', 'name', 'species', 'breed', 'breed_raw', 'sex', 'birthdate', 'microchip', 'legacy_added_on', 'review_flags'], pets),
  `INSERT INTO audit_log (actor, action, entity, detail) VALUES ('import', 'legacy_import', 'owners', ${q(JSON.stringify({ owners: owners.length, pets: pets.length }))});`,
  '',
].join('\n')

// --- Report ---
const count = (list, flag) => list.filter((x) => x.flags.includes(flag))
const list = (items, fmt) => (items.length ? items.map((x) => `- ${fmt(x)}`).join('\n') : '- none')
const report = `# Legacy import report

Generated ${new Date().toISOString()} from \`${args.owners.split('/').pop()}\` and \`${args.pets.split('/').pop()}\`.
Contains client details: keep it out of git (data/ is ignored).

| | Count |
|---|---|
| Owners | ${owners.length} |
| Owners with a valid PH mobile | ${owners.filter((o) => o.mobile).length} |
| Owners with a real email | ${owners.filter((o) => o.email).length} |
| Pets | ${pets.length} (${pets.filter((p) => p.species === 'dog').length} dogs, ${pets.filter((p) => p.species === 'cat').length} cats, ${pets.filter((p) => p.species === 'other').length} other) |
| Pets with a birthdate | ${pets.filter((p) => p.birthdate).length} |
| Pets with a microchip | ${pets.filter((p) => p.microchip).length} |
| Pets skipped (owner not in the owners file) | ${orphans.length} |
| Distinct breeds after clean-up | ${new Set(pets.map((p) => p.breed).filter(Boolean)).size} |

## For staff to review (these show a "Check" badge in the app)

### No phone number (${count(owners, 'no_phone').length})
${list(count(owners, 'no_phone'), (o) => `${o.customer_no} ${o.full_name}`)}

### Phone isn't a valid PH mobile (${count(owners, 'check_phone').length})
${list(count(owners, 'check_phone'), (o) => `${o.customer_no} ${o.full_name}: \`${o.mobile_raw}\``)}

### Same mobile on more than one owner (${count(owners, 'shared_phone').length}) — family members, or duplicates to merge
${list(count(owners, 'shared_phone').sort((a, b) => a.mobile.localeCompare(b.mobile)), (o) => `${o.mobile}: ${o.customer_no} ${o.full_name}`)}

### Same owner name twice (${count(owners, 'same_name').length})
${list(count(owners, 'same_name'), (o) => `${o.customer_no} ${o.full_name}`)}

### Same pet name twice under one owner (${count(pets, 'same_name_same_owner').length})
${list(count(pets, 'same_name_same_owner'), (p) => `${p.owner_no}: ${p.name} (${p.species}, ${p.breed ?? 'no breed'})`)}

## Breed clean-up (old text → standard name)
${[...breedChanges].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k} (${n})`).join('\n')}
`

mkdirSync('data', { recursive: true })
writeFileSync('data/import.sql', sql)
writeFileSync('data/import-report.md', report)
console.log(`Owners ${owners.length}, pets ${pets.length}, skipped pets ${orphans.length}.`)
console.log('Wrote data/import.sql and data/import-report.md')
