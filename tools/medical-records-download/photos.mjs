// Takes the photos out of the medical record PDFs (inside output/zips) so they can be uploaded to the
// clinic app. The photos are stored in the PDFs as ordinary JPEG files, so they come out unchanged:
// no resizing, no quality lost. Doesn't need the internet or a login.
//
//   npm run photos-test      (the first 20 pets)
//   npm run photos
//
// Options: --zips <folder>  --records <records.jsonl>  --out <folder>  --limit N  --redo (start the list again)
//
// Output (default: ./output-photos):
//   files\<pet no.>\<record>-<n>.jpg   the photos (about 250 KB each)
//   photos.jsonl                       which record and entry each photo belongs to (for the app)
//   progress.json                      records already done (running it again carries on)
//
// Each record's entries list their "Image n of m" pages (from records.mjs); each photo is on that page
// or the next, so photos are matched to entries by page. Most are JPEGs (copied unchanged); a few are
// stored as raw pixels and are saved as PNG.

import AdmZip from 'adm-zip'
import { PDFArray, PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync, gunzipSync, inflateSync } from 'node:zlib'
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
// --redo: start the list again (the photos already saved are simply overwritten; uploads are kept).
if (process.argv.includes('--redo')) { writeFileSync(MANIFEST, ''); writeFileSync(PROGRESS, JSON.stringify({ done: {} })) }
const progress = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : { done: {} }
const summary = { failed: [], records: 0, photos: 0, bytes: 0, mismatched: [], unreadable: [], converted: 0, missingPdf: 0 }

// A picture stored as compressed pixels (not JPEG) -> a PNG file, or null if it's a kind we can't convert.
function pngOf(obj, context) {
  const d = obj.dict
  const get = (k) => { const v = d.get(PDFName.of(k)); return v ? context.lookup(v) : undefined }
  if (String(get('Filter')) !== '/FlateDecode') return null
  const w = Number(String(get('Width')))
  const h = Number(String(get('Height')))
  const bpc = Number(String(get('BitsPerComponent') || 8))
  let cs = get('ColorSpace')
  let comps
  let colorType
  let palette = null
  const csName = (c) => (c instanceof PDFArray ? String(c.get(0)) : String(c))
  if (csName(cs) === '/ICCBased') { const n = Number(String(context.lookup(cs.get(1)).dict.get(PDFName.of('N')))); cs = PDFName.of(n === 1 ? 'DeviceGray' : 'DeviceRGB') }
  if (csName(cs) === '/DeviceRGB') { comps = 3; colorType = 2 }
  else if (csName(cs) === '/DeviceGray') { comps = 1; colorType = 0 }
  else if (csName(cs) === '/Indexed') {
    const base = context.lookup(cs.get(1))
    if (csName(base) !== '/DeviceRGB' && !(csName(base) === '/ICCBased')) return null
    const lookup = context.lookup(cs.get(3))
    palette = lookup instanceof PDFRawStream ? (String(lookup.dict.get(PDFName.of('Filter'))) === '/FlateDecode' ? inflateSync(Buffer.from(lookup.contents)) : Buffer.from(lookup.contents))
      : Buffer.from(lookup.asBytes ? lookup.asBytes() : lookup.decodeText(), 'latin1')
    comps = 1; colorType = 3
  } else return null
  if (![1, 2, 4, 8, 16].includes(bpc) || !w || !h) return null
  const parms = get('DecodeParms')
  const predictor = parms instanceof PDFDict ? Number(String(parms.get(PDFName.of('Predictor')) || 1)) : 1
  if (predictor > 1 && predictor < 10) return null // TIFF predictor: not handled
  const data = inflateSync(Buffer.from(obj.contents))
  const rowBytes = Math.ceil((w * comps * bpc) / 8)
  let rows
  if (predictor >= 10) rows = data // already PNG rows: a filter byte, then the pixels
  else {
    rows = Buffer.alloc(h * (rowBytes + 1))
    for (let y = 0; y < h; y++) data.copy(rows, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes)
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb) >>> 0)
    return Buffer.concat([len, tb, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bpc; ihdr[9] = colorType
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...(palette ? [chunk('PLTE', palette.subarray(0, Math.floor(palette.length / 3) * 3))] : []),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

// The pictures in a PDF with their page numbers (1-based). The clinic logo on every page is left out.
async function picturesIn(buffer) {
  const pdf = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: true })
  const out = []
  pdf.getPages().forEach((page, i) => {
    const xo = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xo) return
    for (const [, ref] of xo.entries()) {
      const obj = pdf.context.lookup(ref)
      if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
      const filter = String(obj.dict.get(PDFName.of('Filter')))
      const w = Number(obj.dict.get(PDFName.of('Width'))?.toString())
      const h = Number(obj.dict.get(PDFName.of('Height'))?.toString())
      if (filter === '/DCTDecode') out.push({ page: i + 1, bytes: Buffer.from(obj.contents), w, h, ext: 'jpg', type: 'image/jpeg' })
      else if (w === 500 && h === 500) continue // the logo
      else {
        let png = null
        try { png = pngOf(obj, pdf.context) } catch { png = null }
        if (png) out.push({ page: i + 1, bytes: png, w, h, ext: 'png', type: 'image/png' })
        else out.push({ page: i + 1, unreadable: `${filter} ${w}x${h}` })
      }
    }
  })
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
    let pictures
    try { pictures = await picturesIn(entry.getData()) } catch (err) {
      summary.failed.push(`${zip}/${r.file}: ${String(err.message || err).slice(0, 120)}`)
      continue // not marked done: it's tried again next run
    }
    const wanted = r.entries.reduce((n, e) => n + (e.imageCount || 0), 0)
    // Each photo sits on its "Image n of m" page or the page after it: match by page, not by order.
    const used = new Set()
    const take = (pageNo) => pictures.find((p) => !used.has(p) && (p.page === pageNo || p.page === pageNo + 1))
    const plan = [] // [entryIndex, n, picture]
    r.entries.forEach((e, entryIndex) => {
      const pages = e.imagePages || []
      for (let n = 1; n <= (e.imageCount || 0); n++) {
        const pic = pages[n - 1] ? take(pages[n - 1]) : null
        if (pic) { used.add(pic); plan.push([entryIndex, n, pic]) }
      }
    })
    const found = plan.filter(([, , p]) => !p.unreadable).length
    for (const [, , p] of plan) if (p.unreadable) summary.unreadable.push(`${zip}/${r.file}: page ${p.page} (${p.unreadable})`)
    if (found !== wanted) summary.mismatched.push(`${zip}/${r.file}: ${wanted} listed, ${found} found`)
    // Records with a converted (PNG) picture get new names, so an earlier upload of this record isn't reused.
    const base = r.file.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-') + (plan.some(([, , p]) => p.ext === 'png') ? '-v2' : '')
    const lines = []
    let k = 0
    for (const [entryIndex, n, img] of plan) {
      k++
      if (img.unreadable) continue
      const rel = join('files', petNo, `${base}-${k}.${img.ext}`)
      mkdirSync(dirname(join(OUT, rel)), { recursive: true })
      writeFileSync(join(OUT, rel), img.bytes)
      lines.push(JSON.stringify({ zip, file: r.file, entry: entryIndex, n, key: `legacy/${petNo}/${base}-${k}.${img.ext}`, path: rel.replace(/\\/g, '/'), type: img.type, bytes: img.bytes.length, width: img.w, height: img.h }))
      summary.photos++
      if (img.ext === 'png') summary.converted++
      summary.bytes += img.bytes.length
    }
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
${summary.missingPdf ? `PDFs not found in their zip: ${summary.missingPdf}\n` : ''}${summary.failed.length ? `PDFs that couldn't be read (${summary.failed.length}):\n  ${summary.failed.slice(0, 15).join('\n  ')}\n` : ''}${summary.converted ? `Pictures stored as PNG (converted): ${summary.converted}\n` : ''}${summary.unreadable.length ? `Pictures that couldn't be converted (${summary.unreadable.length}):\n  ${summary.unreadable.slice(0, 15).join('\n  ')}\n` : ''}${summary.mismatched.length ? `Records whose photo count didn't match (${summary.mismatched.length}):\n  ${summary.mismatched.slice(0, 15).join('\n  ')}\n` : ''}`)
