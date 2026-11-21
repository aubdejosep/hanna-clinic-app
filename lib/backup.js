// Nightly backups (Clinic Operations ▸ Backups). Copies the clinic app's database (DB) and the website's (LEADS) into
// the separate backup bucket (BACKUPS, R2 "hanna-clinic-backups"), with a list of every photo in PHOTOS and a report
// of the counts. Run by the inbox intake Worker's 2 AM schedule, and by Back Up Now on the Backups page.
//
//   backups/YYYY-MM-DD/hanna-clinic.sql.gz   the whole clinic database as SQL (schema, then every row)
//   backups/YYYY-MM-DD/hanna-leads.sql.gz    the website's database
//   backups/YYYY-MM-DD/photos.json.gz        every photo's key and size (to check nothing is missing after a restore)
//   backups/YYYY-MM-DD/report.json           when, how big, and how many owners, pets, records… (shown on the page)
//
// Kept: every day for 30 days, then the first backup of each month for 12 months. Older ones are removed from the
// backup bucket only. Restoring: README ▸ Backups and recovery. A .sql file restores into an empty database with
// `npx wrangler d1 execute <database> --remote --file <file>.sql`.

const DAILY_DAYS = 30
const MONTHLY_MONTHS = 12
const PAGE = 500
// Logins in progress aren't copied (only the tables): a restore signs everyone out, and the files never hold session tokens.
const SCHEMA_ONLY = ['sessions', 'login_failures']
const COUNTS = { owners: 'Owners', pets: 'Pets', appointments: 'Visits', medical_records: 'Medical Records', products: 'Products', services: 'Services',
  medications: 'Medications', cash_lines: 'Receipt Rows', payments: 'Payments', inbox_messages: 'Inbox Messages' }

const manilaDay = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10)
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return String(v)
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `X'${[...new Uint8Array(v.buffer || v)].map((b) => b.toString(16).padStart(2, '0')).join('')}'`
  if (Array.isArray(v)) return `X'${v.map((b) => (b & 255).toString(16).padStart(2, '0')).join('')}'`
  return `'${String(v).replace(/'/g, "''")}'`
}
const ident = (n) => `"${String(n).replace(/"/g, '""')}"`

// Text written in pieces into gzip, collected as bytes (the compressed copy is small; the text never sits in memory whole).
function gzipWriter() {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  const enc = new TextEncoder()
  const chunks = []
  const reading = (async () => { const r = cs.readable.getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value) } })()
  let pending = ''
  return {
    async write(s) { pending += s; if (pending.length > 256 * 1024) { await writer.write(enc.encode(pending)); pending = '' } },
    async close() {
      if (pending) await writer.write(enc.encode(pending))
      await writer.close(); await reading
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of chunks) { out.set(c, at); at += c.length }
      return out
    },
  }
}

// One database as SQL: its tables (and their indexes and triggers) and every row. -> { bytes, tables: {name: rows} }
export async function dumpDatabase(db, label) {
  const out = gzipWriter()
  await out.write(`-- ${label}: backup made ${new Date().toISOString()}. Restore into an empty database.\nPRAGMA defer_foreign_keys = true;\n`)
  const { results: objects } = await db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name").all()
  const tables = {}
  for (const t of objects.filter((o) => o.type === 'table')) {
    await out.write(`\n${t.sql};\n`)
    let n = 0
    if (SCHEMA_ONLY.includes(t.name)) { tables[t.name] = 0; continue }
    for (let offset = 0; ; offset += PAGE) {
      const { results } = await db.prepare(`SELECT * FROM ${ident(t.name)} ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`).all()
      for (const row of results) {
        const cols = Object.keys(row)
        await out.write(`INSERT INTO ${ident(t.name)} (${cols.map(ident).join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});\n`)
      }
      n += results.length
      if (results.length < PAGE) break
    }
    tables[t.name] = n
  }
  for (const o of objects.filter((x) => x.type !== 'table')) await out.write(`${o.sql};\n`)
  return { bytes: await out.close(), tables }
}

async function photoList(bucket) {
  const out = gzipWriter()
  let count = 0
  let size = 0
  let cursor
  await out.write('[')
  do {
    const page = await bucket.list({ cursor, limit: 1000 })
    for (const o of page.objects) { await out.write(`${count ? ',' : ''}\n${JSON.stringify({ key: o.key, size: o.size, uploaded: o.uploaded })}`); count++; size += o.size }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  await out.write('\n]\n')
  return { bytes: await out.close(), count, size }
}

// Make today's backup (Manila day). -> the report
export async function runBackup(env, { by = 'schedule' } = {}) {
  if (!env.BACKUPS) throw Object.assign(new Error('The backup bucket isn’t connected yet. See README ▸ Backups and recovery.'), { status: 503 })
  const started = Date.now()
  const day = manilaDay()
  const at = new Date().toISOString()
  const files = []
  const put = async (name, bytes, type) => {
    await env.BACKUPS.put(`backups/${day}/${name}`, bytes, { httpMetadata: { contentType: type } })
    files.push({ name, bytes: bytes.byteLength })
  }
  const clinic = await dumpDatabase(env.DB, 'hanna-clinic')
  await put('hanna-clinic.sql.gz', clinic.bytes, 'application/gzip')
  let leadsTables = null
  if (env.LEADS) { const leads = await dumpDatabase(env.LEADS, 'hanna-leads'); await put('hanna-leads.sql.gz', leads.bytes, 'application/gzip'); leadsTables = leads.tables }
  let photos = null
  if (env.PHOTOS) { const p = await photoList(env.PHOTOS); await put('photos.json.gz', p.bytes, 'application/gzip'); photos = { count: p.count, bytes: p.size } }
  const counts = Object.fromEntries(Object.entries(COUNTS).filter(([t]) => t in clinic.tables).map(([t, label]) => [label, clinic.tables[t]]))
  const report = { day, at, by, seconds: Math.round((Date.now() - started) / 100) / 10, files, counts, photos,
    tables: { 'hanna-clinic': clinic.tables, ...(leadsTables ? { 'hanna-leads': leadsTables } : {}) } }
  await env.BACKUPS.put(`backups/${day}/report.json`, JSON.stringify(report, null, 1), { httpMetadata: { contentType: 'application/json' } })
  report.removed = await prune(env.BACKUPS, day)
  return report
}

// Keep 30 days of daily backups, and the first one of each month for 12 months.
async function prune(bucket, today) {
  const days = await backupDays(bucket)
  const cutoff = new Date(`${today}T12:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - DAILY_DAYS)
  const monthCut = new Date(`${today}T12:00:00Z`); monthCut.setUTCMonth(monthCut.getUTCMonth() - MONTHLY_MONTHS)
  const firstOfMonth = new Set()
  for (const d of [...days].sort()) if (!days.some((x) => x < d && x.slice(0, 7) === d.slice(0, 7))) firstOfMonth.add(d)
  const old = days.filter((d) => d < cutoff.toISOString().slice(0, 10) && !(firstOfMonth.has(d) && d >= monthCut.toISOString().slice(0, 10)))
  for (const d of old) {
    const { objects } = await bucket.list({ prefix: `backups/${d}/` })
    if (objects.length) await bucket.delete(objects.map((o) => o.key))
  }
  return old
}

export async function backupDays(bucket) {
  const days = new Set()
  let cursor
  do {
    const page = await bucket.list({ prefix: 'backups/', delimiter: '/', cursor })
    for (const p of page.delimitedPrefixes || []) { const m = p.match(/^backups\/(\d{4}-\d{2}-\d{2})\/$/); if (m) days.add(m[1]) }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return [...days].sort()
}
