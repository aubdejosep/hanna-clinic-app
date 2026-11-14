// Reading VetAssist's files for Clinic Operations ▸ Import from VetAssist. Shared by the screen (which reads
// the file on the PC and sends cleaned rows in small batches) and the server (lib/vetassist-sync.js).
// No imports from Node or the browser. The same rules as the first-time import scripts in scripts/.

// ---------- CSV (quoted fields, doubled quotes, commas and line breaks inside quotes, BOM) ----------
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  text = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header = [], ...body] = rows.filter((r) => r.some((v) => v.trim()))
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

// ---------- Cleaning ----------
const BLANK = new Set(['', '—', '-', 'n/a', 'na', 'none'])
export const blank = (v) => BLANK.has(String(v ?? '').trim().toLowerCase())
const strip = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/g, '')
export const tidy = (v) => strip(v).replace(/\s+/g, ' ').trim()
export const low = (v) => tidy(v).toLowerCase()
export function mobile(raw) { // -> +639XXXXXXXXX or null
  const m = String(raw || '').replace(/[^\d+]/g, '').match(/^(?:\+?63|0)?(9\d{9})$/)
  return m ? `+63${m[1]}` : null
}
export function realEmail(raw) { // the old system invented vpnoemailN@gmail.com for owners without one
  const e = String(raw || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && !/noemail/.test(e) ? e : null
}
export function isoDay(raw) {
  const s = String(raw || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
export function longDay(text) { // "Sep. 28, 2037" / "September 28, 2037" -> 2037-09-28
  const m = String(text || '').trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/)
  if (!m || !MONTHS[m[1].toLowerCase()]) return null
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}
function clock(text) { // "10:00 AM" -> 10:00
  const m = String(text).match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}
const microchip = (raw) => { const s = String(raw || '').replace(/^="?|"$/g, '').replace(/\s/g, ''); return blank(s) ? null : s }
const SPECIES = { dog: 'dog', cat: 'cat' }
const SEX = { male: 'male', female: 'female' }

// ---------- Masterlist exports ----------
export function readOwners(csvText) {
  const rows = parseCsv(csvText)
  if (rows.length && !('Customer Number' in rows[0] && 'Name' in rows[0])) throw new Error('This isn’t the Masterlist owners export: it needs Customer Number and Name columns.')
  return rows.map((r) => {
    const raw = tidy(r.Phone)
    const m = mobile(raw)
    return { customerNo: tidy(r['Customer Number']), name: tidy(r.Name), mobile: m, mobileRaw: !m && !blank(raw) ? raw : null, email: realEmail(r.Email), vip: /^yes$/i.test(tidy(r.VIP)) ? 1 : 0, addedOn: isoDay(r['Date Added']) }
  }).filter((o) => /^C\d+$/.test(o.customerNo) && o.name)
}
export function readPets(csvText) {
  const rows = parseCsv(csvText)
  if (rows.length && !('Customer Number' in rows[0] && 'Pet Name' in rows[0])) throw new Error('This isn’t a Masterlist pets export: it needs Pet Name and Customer Number columns.')
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  return rows.map((r) => {
    const birth = isoDay(r.Birthdate)
    return {
      customerNo: tidy(r['Customer Number']), ownerName: tidy(r['Owner Name']), name: tidy(r['Pet Name']),
      species: SPECIES[low(r.Species)] || 'other', breed: blank(r.Breed) ? null : tidy(r.Breed), sex: SEX[low(r.Gender)] || 'unknown',
      birthdate: birth && birth <= today ? birth : null, microchip: microchip(r['Microchip Number']), addedOn: isoDay(r['Date Added']),
    }
  }).filter((p) => /^C\d+$/.test(p.customerNo) && p.name)
}

// ---------- Appointments list (tools/medical-records-download/appointments.mjs, appointments.jsonl) ----------
function infoTitle(info) {
  const t = tidy(info)
  if (!t) return null
  for (const title of ['Missed Vaccination', 'Has New Schedule', 'Rescheduled Appointment', 'Follow-up Appointment', 'Cancelled: Deceased Pet']) if (t.startsWith(title)) return title
  return t.split(' | ')[0].slice(0, 120)
}
export function readAppointments(jsonlText) {
  const raw = []
  const seen = new Set()
  for (const line of String(jsonlText || '').split('\n')) {
    if (!line.trim()) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    const key = r.key || null
    if (!key || seen.has(key)) continue
    seen.add(key)
    raw.push(r)
  }
  if (!raw.length) throw new Error('No appointments found. Choose appointments.jsonl from the output-appointments folder.')
  // Service names seen anywhere in the file help split "+1 more" text that ran together.
  const known = new Set()
  for (const r of raw) if (r.services?.[0] && r.services[0] !== 'No services') known.add(tidy(r.services[0]))
  for (const r of raw) {
    const m = (r.moreText || '').match(/^All Services: \|(.*)$/)
    if (m) m[1].split(' | ').map(tidy).filter((t) => t && !t.startsWith('Packages:')).forEach((t) => known.add(t))
  }
  const bySize = [...known].sort((a, b) => b.length - a.length)
  const items = (r) => {
    const vis = (r.services || []).map(tidy).filter(Boolean)
    if (!vis.length || vis[0] === 'No services') return []
    const more = tidy(r.moreText)
    const pkgs = (s) => s.split(',').map(tidy).filter(Boolean)
    if (more.startsWith('All Services: |')) {
      const out = []
      for (const t of more.slice('All Services: |'.length).split(' | ').map(tidy).filter(Boolean)) {
        if (t.startsWith('Packages:')) {
          const last = out[out.length - 1]
          const list = pkgs(t.slice(9))
          if (last && !last.detail) { last.detail = list[0]; list.slice(1).forEach((d) => out.push({ name: last.name, detail: d })) } else list.forEach((d) => out.push({ name: last?.name || vis[0], detail: d }))
        } else out.push({ name: t, detail: null })
      }
      return out
    }
    if (more.startsWith('All Services:')) {
      const parts = more.slice('All Services:'.length).split('Packages: ')
      const out = []
      let name = parts.shift()
      for (let i = 0; i < parts.length; i++) {
        let chunk = parts[i]
        let next = null
        if (i < parts.length - 1) {
          const cat = bySize.find((c) => chunk.endsWith(c) && chunk.length > c.length)
          if (cat) { next = cat; chunk = chunk.slice(0, -cat.length) }
        }
        out.push({ name: tidy(name), detail: tidy(chunk) || null })
        name = next || name
      }
      return out.length ? out : [{ name: vis[0], detail: null }]
    }
    if (more.startsWith('Packages:')) return pkgs(more.replace(/^Packages:\s*\|?/, '')).map((d) => ({ name: vis[0], detail: d }))
    const detail = vis[1] && !/^\d+\s+packages?$/i.test(vis[1]) ? vis[1] : null
    return [{ name: vis[0], detail }]
  }
  const out = []
  const prints = new Set() // a row repeated exactly (same everything) is one booking, as in the first import
  let bad = 0
  for (const r of raw) {
    const day = longDay(r.date)
    const time = clock(r.time)
    if (!day || !time) { bad++; continue }
    const fp = JSON.stringify([low(r.pet), low(r.owner), day, time, r.status, r.services, r.moreText || '', r.info || '', r.bookedBy])
    if (prints.has(fp)) continue
    prints.add(fp)
    const booked = tidy(r.bookedBy)
    out.push({ key: r.key, pet: tidy(r.pet), owner: tidy(r.owner), day, time, legacyStatus: tidy(r.status), info: infoTitle(r.info), bookedBy: /^\+\d+$/.test(booked) ? null : booked || null, items: items(r) })
  }
  return { rows: out, unreadable: bad }
}

// Status in the app for an old row (today = Manila day of the import). Same rules as the first import.
export function appStatus(legacyStatus, day, today) {
  let status = { Cancelled: 'cancelled', Completed: 'completed', Accepted: 'accepted', Pending: 'pending', Arrived: 'arrived', Started: 'started', Dispense: 'dispense', Inpatient: 'inpatient' }[legacyStatus] || 'accepted'
  let unclosed = 0
  if (['arrived', 'started', 'dispense', 'inpatient'].includes(status) && day < today) status = 'completed'
  if (['pending', 'accepted'].includes(status)) { if (day >= today) status = 'accepted'; else unclosed = 1 }
  return { status, unclosed }
}
export function cancelReason(status, info) {
  if (status !== 'cancelled') return null
  return info === 'Cancelled: Deceased Pet' ? 'Pet passed away' : info === 'Has New Schedule' ? 'Rescheduled' : 'Cancelled in the old system'
}

// ---------- Medical records (tools/medical-records-download/records.mjs, records.jsonl[.gz]) ----------
const AUTO = 'This note was automatically created'
const isAuto = (e) => e.type === 'NOTE' && /^auto-generated note record$/i.test(tidy(e.title)) && String(e.description || '').startsWith(AUTO)
const PLACEHOLDER = /^Vaccination record auto-created from (booked|added) service/i
const isPlaceholder = (e) => e.type === 'VACCINATION' && PLACEHOLDER.test(String(e.description || ''))
const TYPE = { NOTE: 'note', VACCINATION: 'vaccination', DIAGNOSIS: 'diagnosis', 'TREATMENT PLAN': 'treatment_plan', PRESCRIPTION: 'prescription' }
const shapeItems = (list) => (list || []).map((i) => ({ kind: i.kind, name: tidy(i.name), detail: tidy(i.detail) || null, qty: i.qty || 1, ...(i.notes && !/^Booked as part of the appointment/i.test(i.notes) ? { notes: tidy(i.notes) } : {}) }))
function shapeEntry(e) {
  if (isAuto(e)) return { type: 'note', title: 'Services and Products', description: null, items: shapeItems(e.items), details: { booked: true }, imageCount: e.imageCount || 0 }
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
      if (dates[0]) details.start = longDay(dates[0])
      if (dates[1]) details.targetEnd = longDay(dates[1])
      continue
    }
    if (into) details[into] = details[into] ? `${details[into]}\n${t}` : t
    else details.other = details.other ? `${details.other}\n${t}` : t
  }
  return {
    type: TYPE[tidy(e.type).toUpperCase()] || 'other', title: title || null,
    description: PLACEHOLDER.test(String(e.description || '')) ? null : strip(e.description).trim() || null,
    items: shapeItems(e.items), details: Object.keys(details).length ? details : null, imageCount: e.imageCount || 0,
  }
}
// One string per record's content, the same whether built from the file or from the database: a record
// whose string hasn't changed is left alone.
export const recordSignature = (r) => JSON.stringify([r.day, r.kind, r.bookingOnly ? 1 : 0, r.entries.map((e) => [e.type, e.title ?? null, e.description ?? null, e.items || [], e.details ?? null, e.imageCount || 0])])

export function readRecords(jsonlText) {
  const out = []
  const skipped = { unreadable: 0, nothingUsable: 0, empty: 0, noDate: 0 }
  for (const line of String(jsonlText || '').split('\n')) {
    if (!line.trim()) continue
    let r
    try { r = JSON.parse(line) } catch { skipped.unreadable++; continue }
    if (r.error) { skipped.unreadable++; continue }
    const real = (r.entries || []).filter((e) => !isAuto(e) && !isPlaceholder(e))
    const bookingOnly = !real.length
    const kept = bookingOnly ? (r.entries || []).filter((e) => isAuto(e) && (e.items || []).length) : (r.entries || [])
    if (!kept.length) { if ((r.entries || []).length) skipped.nothingUsable++; else skipped.empty++; continue }
    const day = longDay(r.date)
    if (!day || !r.recordId) { skipped.noDate++; continue }
    out.push({
      recordId: String(r.recordId), apptNo: r.appointmentNo === 'Standalone' ? null : r.appointmentNo || null, day, kind: r.kind === 'appointment' ? 'visit' : 'record',
      bookingOnly, file: `${r.zip}/${r.file}`,
      pet: { name: tidy(r.pet?.name), birthdate: longDay(r.pet?.birthdate) },
      owner: { name: tidy(r.owner?.name), mobile: mobile(r.owner?.phone) || mobile(String(r.zip || '').split('-').pop()?.replace(/\.zip$/i, '')), address: tidy(r.owner?.address) || null },
      entries: kept.map(shapeEntry),
    })
  }
  if (!out.length && !Object.values(skipped).some(Boolean)) throw new Error('No medical records found. Choose records.jsonl.gz from the output-records folder.')
  return { rows: out, skipped }
}

// ---------- Passed away pets (Masterlist ▸ Deceased Pets export) ----------
export function readDeceased(csvText) {
  const rows = parseCsv(csvText)
  if (rows.length && !('Customer Number' in rows[0] && 'Pet Name' in rows[0])) throw new Error('This isn’t the Deceased Pets export: it needs Pet Name and Customer Number columns.')
  return rows.map((r) => ({ customerNo: tidy(r['Customer Number']), name: tidy(r['Pet Name']), ownerName: tidy(r['Owner Name']) })).filter((p) => /^C\d+$/.test(p.customerNo) && p.name)
}

// ---------- Services (services.mjs, services.json) and products (Inventory ▸ Export, *_products.csv) ----------
const cents = (v) => { const n = Number(String(v ?? '').replace(/[₱,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0 }
export function readServices(jsonText) {
  let list
  try { list = JSON.parse(jsonText) } catch { throw new Error('This isn’t services.json from the output-services folder.') }
  if (!Array.isArray(list)) throw new Error('This isn’t services.json from the output-services folder.')
  const seen = new Set()
  return list.map((s) => ({
    name: tidy(s.name).slice(0, 60), category: tidy(s.category).slice(0, 50) || 'Other', description: tidy(s.description).slice(0, 300) || null,
    priceCents: cents(s.price), active: s.active === false ? 0 : 1, featuredOnline: s.featuredOnline ? 1 : 0,
    variations: (s.variations || []).map((v, i) => ({ name: tidy(v.name).slice(0, 60) || `Option ${i + 1}`, description: tidy(v.description).slice(0, 300) || null, priceCents: cents(v.price) })),
  })).filter((s) => s.name && !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()))
}
const PRODUCT_CATEGORY = {
  'vitamins / supplement': 'Vitamins & Supplements', medicine: 'Medicine', shampoo: 'Shampoo', 'medicated soap': 'Medicated Soap',
  'ear drops': 'Ear & Eye Drops', 'eye drop': 'Ear & Eye Drops', accessories: 'Accessories',
}
export function readProducts(csvText) {
  const rows = parseCsv(csvText)
  if (rows.length && !('Product Name' in rows[0])) throw new Error('This isn’t the inventory export: it needs a Product Name column (the *_products.csv file).')
  const money = (v) => { const n = Number(String(v ?? '').replace(/[₱,\s]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null }
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const raw = low(r.Category)
    if (raw === 'vaccine' || raw === 'services') continue // picked from Services
    const variation = tidy(r.Variations).replace(/^—$/, '')
    const name = tidy(`${tidy(r['Product Name'])}${variation ? ` ${variation}` : ''}`).slice(0, 60)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ name, category: PRODUCT_CATEGORY[raw] || (raw ? tidy(r.Category).replace(/\b\w/g, (c) => c.toUpperCase()) : 'Other'), priceCents: money(r.Price), costCents: money(r['Cost Price']) })
  }
  return out
}

// ---------- Record photos (photos.mjs, photos.jsonl, plus uploaded.txt from upload:photos) ----------
export function readPhotos(jsonlText, uploadedText) {
  const uploaded = new Set(String(uploadedText || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
  if (!uploaded.size) throw new Error('Choose uploaded.txt too (it lists the photos already in storage).')
  const out = []
  for (const line of String(jsonlText || '').split('\n')) {
    if (!line.trim()) continue
    let p
    try { p = JSON.parse(line) } catch { continue }
    if (!p.key || !uploaded.has(p.key)) continue
    out.push({ key: p.key, file: `${p.zip}/${p.file}`, entry: Number(p.entry) || 0, n: Number(p.n) || 0, type: p.type || 'image/jpeg', bytes: p.bytes || null, width: p.width || null, height: p.height || null })
  }
  return out
}
