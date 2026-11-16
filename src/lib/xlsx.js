// Reads an Excel file (.xlsx) in the browser, without a library: an .xlsx is a zip of XML files. The browser's own
// DecompressionStream unzips it. Returns { 'Sheet Name': [[cell, cell, ...], ...] } with numbers as numbers,
// text as text, and empty cells as ''. Dates stay Excel day numbers (see excelDay). Formulas give their saved result.

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// The zip's table of contents (at the end of the file) lists each file, its size and where it starts.
async function unzip(buf) {
  const v = new DataView(buf)
  let end = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('This isn’t an Excel (.xlsx) file. Save it as .xlsx and try again.')
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const files = {}
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    files[name] = { method, data: new Uint8Array(buf, start, size) }
    p += 46 + nameLen + extraLen + commentLen
  }
  return {
    async text(name) {
      const f = files[name] || files[Object.keys(files).find((k) => k.toLowerCase() === name.toLowerCase())]
      if (!f) return null
      return dec.decode(f.method === 0 ? f.data : await inflate(f.data))
    },
  }
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml')
const byTag = (node, tag) => [...node.getElementsByTagNameNS('*', tag)]
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

export async function readXlsx(file) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open Excel files. Update it, or use Chrome.')
  const zip = await unzip(await file.arrayBuffer())
  const book = await zip.text('xl/workbook.xml')
  if (!book) throw new Error('This isn’t an Excel (.xlsx) file. Save it as .xlsx and try again.')
  const relsXml = await zip.text('xl/_rels/workbook.xml.rels')
  const targets = {}
  if (relsXml) for (const r of byTag(xml(relsXml), 'Relationship')) targets[r.getAttribute('Id')] = r.getAttribute('Target')
  const sharedXml = await zip.text('xl/sharedStrings.xml')
  const shared = sharedXml ? byTag(xml(sharedXml), 'si').map((si) => byTag(si, 't').map((t) => t.textContent).join('')) : []
  const out = {}
  for (const s of byTag(xml(book), 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id')
    let target = targets[rid] || ''
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const sheetXml = await zip.text(target)
    if (!sheetXml) continue
    const rows = []
    for (const row of byTag(xml(sheetXml), 'row')) {
      const r = Number(row.getAttribute('r')) - 1
      const cells = []
      for (const c of byTag(row, 'c')) {
        const type = c.getAttribute('t')
        const val = byTag(c, 'v')[0]?.textContent
        let value = ''
        if (type === 's') value = shared[Number(val)] ?? ''
        else if (type === 'inlineStr') value = byTag(c, 't').map((t) => t.textContent).join('')
        else if (type === 'str' || type === 'e') value = val ?? ''
        else if (type === 'b') value = val === '1'
        else if (val != null && val !== '') value = Number(val)
        cells[c.getAttribute('r') ? colIndex(c.getAttribute('r')) : cells.length] = value
      }
      rows[r] = Array.from(cells, (x) => (x === undefined ? '' : x))
    }
    out[s.getAttribute('name')] = Array.from(rows, (x) => x || [])
  }
  return out
}

// Excel stores dates as days since 1899-12-30.
export const excelDay = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400e3).toISOString().slice(0, 10)
