// Takes the photos out of the medical record PDFs (inside output/zips) so they can be uploaded to the
// clinic app. The photos are stored in the PDFs as ordinary JPEG files, so they come out unchanged:
// no resizing, no quality lost. Doesn't need the internet or a login.
//
//   npm run photos-test      (the first 20 pets)
//   npm run photos
//
// Options: --zips <folder>  --records <records.jsonl>  --out <folder>  --limit N
//
// Output (default: ./output-photos):
//   files\<pet no.>\<record>-<n>.jpg   the photos (about 250 KB each)
//   photos.jsonl                       which record and entry each photo belongs to (for the app)
//   progress.json                      records already done (running it again carries on)
//
// Each record's entries list how many images they have (from records.mjs); the PDF holds the
// images in the same order, so they're matched up in order.

import AdmZip from 'adm-zip'
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []))
const ZIPS = resolve(args.zips || join('output', 'zips'))
const OUT = resolve(args.out || 'output-photos')
const LIMIT = Number(args.limit) || Infinity
const recordsPath = resolve(args.records || (existsSync(join('output-records', 'records.jsonl')) ? join('output-records', 'records.jsonl') : join('output-records', 'records.jsonl.gz')))
const log = (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`)

if (!existsSync(ZIPS)) { console.error(`\nCan't find the zips folder: ${ZIPS}\nRun this in tools\\medical-records-download, or add --zips <folder>.\n`); process.exit(1) }
if (!existsSync(recordsPath)) { console.error(`\nCan't find ${recordsPath}. Run "npm run records" first, or add --records <file>.\n`); process.exit(1) }

const raw = readFileSync(recordsPath)
const text = recordsPath.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
const records = text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => (r.entries || []).some((e) => e.imageCount > 0))
const byZip = new Map()
for (const r of records) (byZip.get(r.zip) || byZip.set(r.zip, []).get(r.zip)).push(r)

mkdirSync(join(OUT, 'files'), { recursive: true })
const MANIFEST = join(OUT, 'photos.jsonl')
const PROGRESS = join(OUT, 'progress.json')
const progress = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : { done: {} }
const summary = { records: 0, photos: 0, bytes: 0, mismatched: [], otherFormat: 0, missingPdf: 0 }

// The JPEG photos in a PDF, in page order. (The clinic logo on every page isn't a JPEG.)
async function jpegsIn(buffer) {
  const pdf = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: true })
  const out = []
  for (const page of pdf.getPages()) {
    const xo = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
    if (!xo) continue
    for (const [, ref] of xo.entries()) {
      const obj = pdf.context.lookup(ref)
      if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
      const filter = String(obj.dict.get(PDFName.of('Filter')))
      const w = Number(obj.dict.get(PDFName.of('Width'))?.toString())
      const h = Number(obj.dict.get(PDFName.of('Height'))?.toString())
      if (filter === '/DCTDecode') out.push({ bytes: Buffer.from(obj.contents), w, h })
      else if (!(w === 500 && h === 500)) summary.otherFormat++
    }
  }
  return out
}

const zips = [...byZip.keys()].filter((z) => existsSync(join(ZIPS, z))).sort()
const inZips = zips.reduce((n, z) => n + byZip.get(z).length, 0)
log(`${inZips} records with photos, in ${zips.length} pet zips. Already done: ${Object.keys(progress.done).length} records.`)
let pets = 0
for (const zip of zips) {
  if (pets >= LIMIT) break
  const todo = byZip.get(zip).filter((r) => !progress.done[`${zip}/${r.file}`])
  if (!todo.length) continue
  pets++
  const archive = new AdmZip(join(ZIPS, zip))
  const petNo = zip.match(/^\d+/)?.[0] || zip.replace(/\.zip$/i, '') // the zip's number, not the owner's phone
  for (const r of todo) {
    const entry = archive.getEntries().find((e) => e.entryName.endsWith(r.file))
    if (!entry) { summary.missingPdf++; continue }
    const jpegs = await jpegsIn(entry.getData())
    const wanted = r.entries.reduce((n, e) => n + (e.imageCount || 0), 0)
    if (jpegs.length !== wanted) summary.mismatched.push(`${zip}/${r.file}: ${wanted} listed, ${jpegs.length} found`)
    let k = 0
    const base = r.file.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-') // plain names for storage
    const lines = []
    r.entries.forEach((e, entryIndex) => {
      for (let n = 1; n <= (e.imageCount || 0) && k < jpegs.length; n++, k++) {
        const img = jpegs[k]
        const rel = join('files', petNo, `${base}-${k + 1}.jpg`)
        mkdirSync(dirname(join(OUT, rel)), { recursive: true })
        writeFileSync(join(OUT, rel), img.bytes)
        lines.push(JSON.stringify({ zip, file: r.file, entry: entryIndex, n, key: `legacy/${petNo}/${base}-${k + 1}.jpg`, path: rel.replace(/\\/g, '/'), bytes: img.bytes.length, width: img.w, height: img.h }))
        summary.photos++
        summary.bytes += img.bytes.length
      }
    })
    if (lines.length) appendFileSync(MANIFEST, `${lines.join('\n')}\n`)
    progress.done[`${zip}/${r.file}`] = 1
    summary.records++
  }
  writeFileSync(PROGRESS, JSON.stringify(progress))
  if (pets % 25 === 0) log(`${pets} pets done this run, ${summary.photos} photos (${(summary.bytes / 1e6).toFixed(0)} MB).`)
}
const total = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8').split('\n').filter(Boolean).length : 0
log(`Done this run: ${summary.records} records, ${summary.photos} photos, ${(summary.bytes / 1e6).toFixed(0)} MB.`)
console.log(`
Photos so far: ${total} (in ${join(OUT, 'files')})
Records done:  ${Object.keys(progress.done).length} of ${inZips}
${summary.missingPdf ? `PDFs not found in their zip: ${summary.missingPdf}\n` : ''}${summary.otherFormat ? `Pictures in another format (not JPEG), left out: ${summary.otherFormat}\n` : ''}${summary.mismatched.length ? `Records whose photo count didn't match (${summary.mismatched.length}):\n  ${summary.mismatched.slice(0, 15).join('\n  ')}\n` : ''}`)
