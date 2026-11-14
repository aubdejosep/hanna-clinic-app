// Reads the medical record PDFs inside output/zips (from download.mjs) and writes their text to
// one file Claude can import: who the pet and owner are, each record's date and old appointment
// number, and every entry (type, title, description, services used, how many images).
// Photos stay in the zips; they are uploaded to the app's own storage in a later step.
//
//   npm run records-test   -> the first 20 pets, to check it works
//   npm run records        -> every pet (resumes by itself if stopped)
//
// Options: --zips <folder>  --out <folder>  --limit N
//
// Output (default: ./output-records):
//   records.jsonl      one line per PDF
//   records.jsonl.gz   the same, compressed: this is the file to send
//   summary.txt        counts, plus anything that looked unusual
//   progress.json      zips already read (resume uses this)

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import AdmZip from 'adm-zip'
import { appendFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

const args = parseArgs(process.argv.slice(2))
const ZIPS = resolve(args.zips || join('output', 'zips'))
const OUT = resolve(args.out || 'output-records')
const LIMIT = args.limit ? Number(args.limit) : Infinity
const JSONL = join(OUT, 'records.jsonl')
const PROGRESS = join(OUT, 'progress.json')
mkdirSync(OUT, { recursive: true })

function parseArgs(list) {
  const out = {}
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue
    const key = list[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const next = list[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}
const log = (...m) => console.log(`[${new Date().toLocaleTimeString()}]`, ...m)

// ---------- Reading one PDF ----------
// Each piece of text with its position: x from the left, y from the bottom, size in points.
async function pagesOf(data) {
  const doc = await getDocument({ data: new Uint8Array(data), verbosity: 0, isEvalSupported: false, disableFontFace: true }).promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const tc = await page.getTextContent()
    pages.push(tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({
      s: it.str, x: it.transform[4], y: it.transform[5], size: Math.round(Math.abs(it.transform[0]) * 10) / 10, w: it.width, font: it.fontName,
    })))
    page.cleanup()
  }
  await doc.destroy()
  return pages
}
// Pieces on the same line, left to right, joined with a space where there's a gap.
function lines(items) {
  const rows = []
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < 2)
    if (row) row.items.push(it)
    else rows.push({ y: it.y, items: [it] })
  }
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x)
    let text = ''
    let end = null
    for (const it of r.items) {
      if (end !== null && it.x - end > 1) text += ' '
      text += it.s
      end = it.x + it.w
    }
    return { y: r.y, x: r.items[0].x, size: Math.max(...r.items.map((i) => i.size)), text: text.replace(/\s+/g, ' ').trim() }
  })
}
const body = (items) => items.filter((it) => it.y > 45 && it.y < 755) // drop the clinic letterhead and the footer

// Page 1: label/value boxes (NAME, SPECIES, FULL NAME, PHONE, APPOINTMENT NUMBER, RECORD DATE…).
function boxes(items) {
  const labels = items.filter((it) => it.size <= 8.5 && /^[A-Z][A-Z /]+$/.test(it.s.trim()) && it.y > 380)
  const out = {}
  for (const l of labels) {
    const right = Math.min(...labels.filter((o) => Math.abs(o.y - l.y) < 2 && o.x > l.x + 5).map((o) => o.x), Infinity)
    const below = labels.filter((o) => o.x >= l.x - 2 && o.x < right && o.y < l.y - 2).map((o) => o.y)
    const floor = below.length ? Math.max(...below) : l.y - 40
    const vals = items.filter((it) => it.size >= 9.5 && it.size <= 10.5 && it.x >= l.x - 2 && it.x < right && it.y < l.y - 2 && it.y > floor + 2)
    out[l.s.trim()] = lines(vals).map((v) => v.text).join(' ').trim()
  }
  return out
}

const KNOWN = ['RECORD TYPE', 'TITLE', 'DESCRIPTION', 'ITEMS', 'IMAGES']
const unusual = {} // all-caps label-like lines that aren't one of the known sections, for the summary
function readEntries(pages) {
  const entries = []
  let entry = null
  let section = null
  for (let p = 1; p < pages.length; p++) {
    const ls = lines(body(pages[p]))
    const img = ls.find((l) => /^Image \d+ of \d+$/.test(l.text))
    if (img) { if (entry) entry.imagePages.push(p + 1); continue }
    for (const l of ls) {
      if (l.text === 'Medical Record' && l.size >= 11) continue
      if (KNOWN.includes(l.text) && l.size <= 8.5) {
        section = l.text
        if (section === 'RECORD TYPE') { entry = { type: '', title: '', description: [], items: [], imageCount: 0, imagePages: [], other: [], page: p + 1 }; entries.push(entry) }
        continue
      }
      if (!entry) continue
      if (l.size <= 8.5 && /^[A-Z][A-Z /&()-]{3,40}$/.test(l.text) && section !== 'DESCRIPTION' && section !== 'ITEMS') {
        unusual[l.text] = (unusual[l.text] || 0) + 1
        section = l.text
        continue
      }
      if (section === 'RECORD TYPE') entry.type += (entry.type ? ' ' : '') + l.text
      else if (section === 'TITLE') entry.title += (entry.title ? ' ' : '') + l.text
      else if (section === 'DESCRIPTION') entry.description.push(l.text)
      else if (section === 'ITEMS') {
        const m = l.text.match(/^\[(\w+)\]\s+(.*?)(?:\s+\((.*)\))?\s+(\d+(?:\.\d+)?)x$/)
        if (m) entry.items.push({ kind: m[1].toLowerCase(), name: m[2].trim(), detail: (m[3] || '').trim() || null, qty: Number(m[4]) })
        else if (/^Notes?:/i.test(l.text) && entry.items.length) entry.items[entry.items.length - 1].notes = l.text.replace(/^Notes?:\s*/i, '')
        else entry.other.push({ section, text: l.text })
      } else if (section === 'IMAGES') {
        const m = l.text.match(/contains (\d+) image/)
        if (m) entry.imageCount = Number(m[1])
      } else entry.other.push({ section, text: l.text })
    }
  }
  return entries.map((e) => ({ ...e, description: e.description.join('\n'), other: e.other.length ? e.other : undefined }))
}

async function readPdf(data, file) {
  const pages = await pagesOf(data)
  const first = body(pages[0] || [])
  const b = boxes(first)
  const na = (v) => (!v || v === 'N/A' ? null : v)
  return {
    file,
    kind: /appointment/i.test(file) ? 'appointment' : 'record',
    recordId: na(b['RECORD ID']),
    appointmentNo: na(b['APPOINTMENT NUMBER']),
    date: na(b['RECORD DATE'] || b['VISIT DATE']),
    pet: { name: na(b.NAME), species: na(b.SPECIES), breed: na(b.BREED), sex: na(b.GENDER), birthdate: na(b['DATE OF BIRTH']), age: na(b.AGE) },
    owner: { name: na(b['FULL NAME']), phone: na(b.PHONE), email: na(b.EMAIL)?.replace(/\s+/g, '') || null, address: na(b.ADDRESS) },
    pages: pages.length,
    entries: readEntries(pages),
    headerFields: Object.keys(b).filter((k) => !['NAME', 'SPECIES', 'BREED', 'GENDER', 'DATE OF BIRTH', 'AGE', 'FULL NAME', 'PHONE', 'EMAIL', 'ADDRESS', 'RECORD ID', 'APPOINTMENT NUMBER', 'RECORD DATE', 'VISIT DATE', 'GENERATED ON'].includes(k)),
  }
}

// ---------- Main ----------
if (!existsSync(ZIPS)) {
  console.error(`\nCan't find the zips folder: ${ZIPS}\nRun this in tools\\medical-records-download, or add --zips <folder>.\n`)
  process.exit(1)
}
const progress = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : { done: {}, failed: {} }
const saveProgress = () => { writeFileSync(PROGRESS + '.tmp', JSON.stringify(progress)); renameSync(PROGRESS + '.tmp', PROGRESS) }
// --redo-zips <last-run.json>: read these zips again (downloaded again by npm run sync): their old lines go.
if (args.redoZips && args.redoZips !== true) {
  const again = new Set(JSON.parse(readFileSync(resolve(args.redoZips), 'utf8')).zips || [])
  if (again.size) {
    for (const z of again) { delete progress.done[z]; delete progress.failed[z] }
    if (existsSync(JSONL)) {
      const keep = readFileSync(JSONL, 'utf8').split('\n').filter((l) => { if (!l.trim()) return false; try { return !again.has(JSON.parse(l).zip) } catch { return false } })
      writeFileSync(JSONL + '.tmp', keep.length ? keep.join('\n') + '\n' : '')
      renameSync(JSONL + '.tmp', JSONL)
    }
    saveProgress()
    log(`Reading ${again.size} downloaded zip${again.size === 1 ? '' : 's'} again.`)
  }
}
const zips = readdirSync(ZIPS).filter((f) => /\.zip$/i.test(f) && !/\.part/i.test(f)).sort()
log(`${zips.length} pet zips in ${ZIPS}. Already read: ${Object.keys(progress.done).length}.`)

let read = 0
let pdfs = 0
const started = Date.now()
for (const zip of zips) {
  if (read >= LIMIT) break
  if (progress.done[zip]) continue
  const rows = []
  try {
    const archive = new AdmZip(join(ZIPS, zip))
    for (const e of archive.getEntries()) {
      if (e.isDirectory || !/\.pdf$/i.test(e.entryName)) continue
      try {
        rows.push({ zip, ...(await readPdf(e.getData(), e.entryName)) })
      } catch (err) {
        rows.push({ zip, file: e.entryName, error: String(err.message || err).slice(0, 200) })
      }
    }
    appendFileSync(JSONL, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))
    progress.done[zip] = rows.length
    delete progress.failed[zip]
  } catch (err) {
    progress.failed[zip] = String(err.message || err).slice(0, 200)
    log(`  Couldn't open ${zip}: ${progress.failed[zip]}`)
  }
  saveProgress()
  read++
  pdfs += rows.length
  if (read % 25 === 0) {
    const per = (Date.now() - started) / read
    const left = Math.min(LIMIT, zips.length - Object.keys(progress.done).length)
    log(`${Object.keys(progress.done).length} of ${zips.length} pets read (${pdfs} PDFs this run). About ${Math.ceil((per * left) / 60000)} min to go.`)
  }
}

// ---------- Summary and the file to send ----------
const all = existsSync(JSONL) ? readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const count = (f) => all.reduce((n, r) => n + f(r), 0)
const types = {}
const fields = {}
for (const r of all) {
  for (const e of r.entries || []) types[e.type] = (types[e.type] || 0) + 1
  for (const f of r.headerFields || []) fields[f] = (fields[f] || 0) + 1
}
const summary = `Medical records read on ${new Date().toISOString()}
Pets (zips) read: ${Object.keys(progress.done).length} of ${zips.length}
PDFs: ${all.length} (records: ${count((r) => r.kind === 'record')}, appointments: ${count((r) => r.kind === 'appointment')})
PDFs that couldn't be read: ${count((r) => (r.error ? 1 : 0))}
Zips that couldn't be opened: ${Object.keys(progress.failed).length}${Object.keys(progress.failed).length ? '\n  ' + Object.entries(progress.failed).map(([z, e]) => `${z}: ${e}`).join('\n  ') : ''}
Entries by type: ${JSON.stringify(types)}
Entries with images: ${count((r) => (r.entries || []).filter((e) => e.imageCount).length)} (images: ${count((r) => (r.entries || []).reduce((n, e) => n + e.imageCount, 0))})
Other header fields seen: ${JSON.stringify(fields)}
Other entry sections seen (this run): ${JSON.stringify(unusual)}
`
writeFileSync(join(OUT, 'summary.txt'), summary)
if (existsSync(JSONL)) await pipeline(createReadStream(JSONL), createGzip({ level: 9 }), createWriteStream(JSONL + '.gz'))
console.log(`
------------------------------------------------------------------
${summary.trim()}

 File to send: ${JSONL}.gz
------------------------------------------------------------------`)
