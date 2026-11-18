// Finances ▸ Ledger (owners and admins) and Finances ▸ Receipts (every staff member): the cash ledger, typed in like
// a spreadsheet. Math: lib/daily-cash.js. Every staff member may read one day at a time, and add or change its
// receipts, items, expenses, photos and summary; several days at once, remits, imports and the Overview's numbers
// are for owners and admins.
// Two separate records per day ("books"): 'owner' (the Ledger, Import File, Copy from Staff) and 'staff' (the
// Receipts page). Requests say ?book=staff / {book: 'staff'}; staff who aren't owners or admins only ever reach
// 'staff'. The Ledger's Compare view reads both books; POST /copy {day, commit} copies staff's day into the Ledger.
//   GET    /api/finances/daily?from=YYYY-MM-DD&to=YYYY-MM-DD -> receipts, expenses and remits in that range
//   POST   /api/finances/daily/lines     {day, receiptNo, receiptQr, clientName, petNames, note (Notes), amountCents (Total Per
//                                          Receipt), discountCents, onlineCents, depositCents, balanceCents, incomeCents, commissionCents}
//   PATCH  /api/finances/daily/lines/:id (the same)            DELETE -> soft-deleted
//   POST   /api/finances/daily/items     {lineId, item, amountCents}: one item of a receipt   PATCH / DELETE /items/:id
//   POST   /api/finances/daily/expenses  {day, category, description, amountCents}   PATCH / DELETE /expenses/:id
//   POST   /api/finances/daily/remits    {day, kind: first|second, amountCents, remittedBy}   PATCH / DELETE /remits/:id
//   POST   /api/finances/daily/import    {file, commit, lines, expenses, remits} (rows from lib/ledger-import.js)
//          -> what each row will do (add / skip: already in the Ledger / error) and each day's totals; with
//             commit: true, adds the "add" rows in one go and logs it. Never changes or removes existing rows.
//   GET    /api/finances/daily/overview?from&to&prevFrom&prevTo -> the Overview's Ledger section (lib/ledger-overview.js)
//   GET    /api/finances/daily/photos/:lineId   POST (the image as the body) -> a receipt's photo (R2)
//   PUT    /api/finances/daily/summary   {day, incomeCents, expensesCents, onlineCents, firstRemitCents, cashOnHandCents,
//                                          onlineList, groomingList, note}: the front desk's typed summary for the day
//   GET    /api/finances/daily/imports           -> the last 20 imports, with how many of their rows are still there
//   POST   /api/finances/daily/imports/:id/undo  -> Undo Import: soft-deletes the rows that import added (only those)
// Rows can be saved half-filled (a spreadsheet is typed cell by cell); blanks count as 0.

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'
import { EXPENSE_TYPES } from '../../../../lib/daily-cash.js'
import { ledgerOverview } from '../../../../lib/ledger-overview.js'

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
const money = (v) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 1e10 ? n : NaN }
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

const PAID_WITH = ['cash', 'gcash', 'bank', 'maribank', 'card', 'qrph', 'none']
const MANAGER_ONLY = ['remits', 'import', 'imports', 'overview', 'copy']
const PHOTO_MAX = 8 * 1024 * 1024
const TABLES = {
  lines: {
    table: 'cash_lines', entity: 'cash_line',
    fields(b, errors) {
      const m = {}
      for (const [k, col, label] of [['amountCents', 'amount_cents', 'Total Per Receipt'], ['discountCents', 'discount_cents', 'Discounts'], ['onlineCents', 'online_cents', 'Online Payments'], ['depositCents', 'deposit_cents', 'Deposit'],
        ['balanceCents', 'balance_cents', 'Balance'], ['incomeCents', 'income_cents', 'Total Income'], ['commissionCents', 'commission_cents', 'Commissions']]) {
        const v = money(b[k])
        if (Number.isNaN(v)) errors[k] = `Enter ${label} as a number, e.g. 1500.`
        m[col] = Number.isNaN(v) ? null : v
      }
      return { receipt_no: clean(b.receiptNo, 40) || null, receipt_qr: clean(b.receiptQr, 40) || null, client_name: clean(b.clientName, 120) || null,
        pet_names: clean(b.petNames, 200) || null, note: clean(b.note, 300) || null, ...m, amount_cents: m.amount_cents ?? 0,
        paid_with: PAID_WITH.includes(b.paidWith) ? b.paidWith : null,
        ...(b.photoRotate !== undefined ? { photo_rotate: [90, 180, 270].includes(Number(b.photoRotate)) ? Number(b.photoRotate) : 0 } : {}) }
    },
    shape: (r) => ({ id: r.id, day: r.day, receiptNo: r.receipt_no || '', receiptQr: r.receipt_qr || '', clientName: r.client_name || '', petNames: r.pet_names || '',
      note: r.note || '', amountCents: r.amount_cents || null, discountCents: r.discount_cents ?? null, onlineCents: r.online_cents, depositCents: r.deposit_cents, balanceCents: r.balance_cents,
      incomeCents: r.income_cents, commissionCents: r.commission_cents, paidWith: r.paid_with || '', photo: !!r.photo_key, photoRotate: r.photo_rotate || 0, items: r.items || [] }),
  },
  expenses: {
    table: 'cash_expenses', entity: 'cash_expense',
    fields(b, errors) {
      const amount = money(b.amountCents)
      if (Number.isNaN(amount)) errors.amountCents = 'Enter the amount as a number, e.g. 160.'
      return { category: EXPENSE_TYPES.includes(b.category) ? b.category : 'Other', description: clean(b.description, 200) || null, amount_cents: amount ?? 0 }
    },
    shape: (r) => ({ id: r.id, day: r.day, category: r.category, description: r.description || '', amountCents: r.amount_cents }),
  },
  remits: {
    table: 'cash_remits', entity: 'cash_remit',
    fields(b, errors) {
      const amount = money(b.amountCents)
      if (Number.isNaN(amount)) errors.amountCents = 'Enter the amount as a number, e.g. 9820.'
      return { kind: b.kind === 'second' ? 'second' : 'first', amount_cents: amount ?? 0, remitted_by: clean(b.remittedBy, 80) || null }
    },
    shape: (r) => ({ id: r.id, day: r.day, kind: r.kind, amountCents: r.amount_cents, remittedBy: r.remitted_by || '' }),
  },
}

export async function onRequest({ request, env, params, data }) {
  const [what, rawId, action] = [].concat(params.path || [])
  const manager = canManage(data.staff)
  if (!manager && MANAGER_ONLY.includes(what)) return fail(403, 'Only an owner or admin can do this.')
  const bookOf = (v) => (!manager || v === 'staff' ? 'staff' : 'owner')
  const mine = manager ? '1' : "book = 'staff'" // which rows this person may change
  const id = rawId ? Number(rawId) : null
  const method = request.method
  const who = data.staff.name
  const now = new Date().toISOString()

  if (method === 'GET' && !what) {
    const u = new URL(request.url).searchParams
    const from = u.get('from') || manilaToday()
    const to = u.get('to') || from
    if (!isDay(from) || !isDay(to) || from > to) return fail(400, 'Choose the dates to show.')
    if (!manager && from !== to) return fail(403, 'Choose one day at a time.')
    const book = bookOf(u.get('book'))
    const q = (t, order) => env.DB.prepare(`SELECT * FROM ${t} WHERE branch_id = 1 AND book = ? AND day BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY day, ${order}`).bind(book, from, to)
    const [l, e, r, it] = await env.DB.batch([q('cash_lines', 'sort, id'), q('cash_expenses', 'id'),
      env.DB.prepare(`SELECT * FROM cash_remits WHERE branch_id = 1 AND day BETWEEN ? AND ? AND deleted_at IS NULL AND ? = 'owner' ORDER BY day, kind, id`).bind(from, to, book),
      env.DB.prepare(`SELECT i.* FROM cash_line_items i JOIN cash_lines l ON l.id = i.line_id WHERE l.branch_id = 1 AND l.book = ? AND l.day BETWEEN ? AND ? AND l.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY i.sort, i.id`).bind(book, from, to)])
    // The Ledger's rows show the photo staff attached to the same receipt number.
    const staffPhotos = book === 'owner' ? await photosByNumber(env, l.results) : {}
    const items = {}
    for (const i of it.results) (items[i.line_id] ||= []).push(itemShape(i))
    const sum = from === to ? await env.DB.prepare('SELECT * FROM cash_summaries WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL').bind(from).first() : null
    return json({ from, to, summary: sum ? summaryShape(sum) : null, book, lines: l.results.map((x) => ({ ...TABLES.lines.shape({ ...x, items: items[x.id] }), staffPhoto: staffPhotos[x.receipt_no || ''] || staffPhotos[x.receipt_qr || ''] || null })), expenses: e.results.map(TABLES.expenses.shape), remits: r.results.map(TABLES.remits.shape) })
  }

  if (what === 'photos') return photoRoute(env, data.staff, request, method, id, manager)
  if (what === 'copy' && method === 'POST') return copyStaffDay(env, data.staff, (await readJson(request)) || {})
  if (what === 'summary' && method === 'PUT') return saveSummary(env, data.staff, (await readJson(request)) || {})
  if (what === 'items') return itemRoute(env, data.staff, method, id, method === 'DELETE' ? {} : (await readJson(request)) || {}, mine)
  if (what === 'import' && method === 'POST') return importRows(env, data.staff, (await readJson(request)) || {})
  if (what === 'imports' && method === 'GET' && !id) return listImports(env)
  if (what === 'overview' && method === 'GET') {
    const u = new URL(request.url).searchParams
    const r = Object.fromEntries(['from', 'to', 'prevFrom', 'prevTo'].map((k) => [k, u.get(k)]))
    if (!Object.values(r).every(isDay) || r.from > r.to || r.prevFrom > r.prevTo) return fail(400, 'Choose the dates to show.')
    if ((new Date(r.to) - new Date(r.from)) / 864e5 > 1100) return fail(400, 'Choose up to 3 years at a time.')
    return json(await ledgerOverview(env, r))
  }
  if (what === 'imports' && method === 'POST' && id && action === 'undo') return undoImport(env, data.staff, id)
  const t = TABLES[what]
  if (!t) return fail(404, 'Not found.')
  if (method === 'DELETE' && id) {
    const gone = await env.DB.prepare(`UPDATE ${t.table} SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL${what === 'remits' ? '' : ` AND ${mine}`}`).bind(now, who, id).run()
    if (!gone.meta?.changes) return fail(404, 'This row was not found. Reload the page.')
    await audit(env, data.staff.email, 'delete', t.entity, id)
    return json({ ok: true })
  }
  const b = (await readJson(request)) || {}
  const errors = {}
  const f = t.fields(b, errors)
  if (!isDay(b.day)) errors.day = 'Enter the date.'
  if (Object.keys(errors).length) return fail(400, Object.values(errors)[0], { errors })
  f.day = b.day
  if (what !== 'remits' && method === 'POST') f.book = bookOf(b.book)
  const cols = Object.keys(f)
  if (method === 'POST') {
    const extra = what === 'lines' ? ', sort' : ''
    const extraVal = what === 'lines' ? ', (SELECT COALESCE(MAX(sort), 0) + 1 FROM cash_lines WHERE day = ? AND book = ?)' : ''
    const row = await env.DB.prepare(`INSERT INTO ${t.table} (${cols.join(', ')}${extra}, created_by) VALUES (${cols.map(() => '?').join(', ')}${extraVal}, ?) RETURNING *`)
      .bind(...cols.map((c) => f[c]), ...(what === 'lines' ? [f.day, f.book] : []), who).first()
    await audit(env, data.staff.email, 'create', t.entity, row.id, { day: f.day })
    return json({ row: t.shape(row) }, 201)
  }
  if (method === 'PATCH' && id) {
    const row = await env.DB.prepare(`UPDATE ${t.table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL${what === 'remits' ? '' : ` AND ${mine}`} RETURNING *`)
      .bind(...cols.map((c) => f[c]), now, who, id).first()
    if (!row) return fail(404, 'This row was not found. Reload the page.')
    await audit(env, data.staff.email, 'update', t.entity, id)
    return json({ row: t.shape(row) })
  }
  return fail(405, 'Not allowed.')
}

// ---------- Import File ----------
const MAX_IMPORT = 1000
const short = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

async function importRows(env, staff, b) {
  const input = { lines: [].concat(b.lines || []), expenses: [].concat(b.expenses || []), remits: [].concat(b.remits || []) }
  const total = input.lines.length + input.expenses.length + input.remits.length
  if (!total) return fail(400, 'The file has no rows to import.')
  if (total > MAX_IMPORT) return fail(400, `The file has ${total} rows; import up to ${MAX_IMPORT} at a time.`)
  const days = [...new Set(Object.values(input).flat().map((r) => r && r.day).filter(isDay))].sort()

  // What's already in the Ledger: receipt numbers anywhere, and these days' expenses and remits.
  const nums = [...new Set(input.lines.flatMap((r) => [r && r.receiptNo, r && r.receiptQr]).map((x) => clean(x, 40)).filter(Boolean))]
  const have = { no: new Map(), qr: new Map() }
  for (let i = 0; i < nums.length; i += 40) {
    const part = nums.slice(i, i + 40)
    const q = part.map(() => '?').join(', ')
    const { results } = await env.DB.prepare(`SELECT day, receipt_no, receipt_qr FROM cash_lines WHERE branch_id = 1 AND book = 'owner' AND deleted_at IS NULL AND (receipt_no IN (${q}) OR receipt_qr IN (${q}))`).bind(...part, ...part).all()
    for (const r of results) { if (r.receipt_no) have.no.set(r.receipt_no, r.day); if (r.receipt_qr) have.qr.set(r.receipt_qr, r.day) }
  }
  let oldExpenses = []
  let oldRemits = []
  if (days.length) {
    const q = days.map(() => '?').join(', ')
    ;[oldExpenses, oldRemits] = (await env.DB.batch([
      env.DB.prepare(`SELECT day, description, amount_cents FROM cash_expenses WHERE branch_id = 1 AND book = 'owner' AND deleted_at IS NULL AND day IN (${q})`).bind(...days),
      env.DB.prepare(`SELECT day, kind FROM cash_remits WHERE branch_id = 1 AND deleted_at IS NULL AND day IN (${q})`).bind(...days),
    ])).map((r) => r.results)
  }

  const plan = { lines: [], expenses: [], remits: [] }
  const seen = { no: new Map(), qr: new Map(), remit: new Set() }
  for (const kind of ['lines', 'expenses', 'remits']) {
    input[kind].forEach((raw, i) => {
      const r = raw && typeof raw === 'object' ? raw : {}
      const errors = {}
      const f = TABLES[kind].fields(r, errors)
      const issues = [].concat(r.issues || []).map((x) => clean(String(x), 120)).filter(Boolean)
      if (!isDay(r.day) && !issues.some((x) => /date/i.test(x))) issues.push('No date')
      issues.push(...Object.values(errors))
      const warnings = []
      const out = { sheet: clean(r.sheet, 40), line: Number(r.line) || i + 1, day: isDay(r.day) ? r.day : null, row: TABLES[kind].shape({ ...f, day: r.day }), status: 'add', reason: '', warnings }
      if (kind === 'expenses' && r.note) warnings.push(clean(r.note, 120))
      if (kind === 'lines') {
        if (!f.receipt_no && !f.receipt_qr && !f.client_name && !f.amount_cents && !f.income_cents) issues.push('Empty row')
        const dup = (f.receipt_no && (have.no.get(f.receipt_no) ? `OR ${f.receipt_no} is already in the Ledger (${short(have.no.get(f.receipt_no))})` : seen.no.has(f.receipt_no) ? `OR ${f.receipt_no} is twice in this file (row ${seen.no.get(f.receipt_no)})` : ''))
          || (f.receipt_qr && (have.qr.get(f.receipt_qr) ? `QR ${f.receipt_qr} is already in the Ledger (${short(have.qr.get(f.receipt_qr))})` : seen.qr.has(f.receipt_qr) ? `QR ${f.receipt_qr} is twice in this file (row ${seen.qr.get(f.receipt_qr)})` : ''))
        if (dup) { out.status = 'skip'; out.reason = dup }
        if (f.receipt_no) seen.no.set(f.receipt_no, out.line)
        if (f.receipt_qr) seen.qr.set(f.receipt_qr, out.line)
        if (f.income_cents == null && f.amount_cents) warnings.push('No Total Income: not counted in the totals')
        const net = f.income_cents != null ? f.income_cents - (f.discount_cents || 0) : null
        if (f.online_cents && net != null && f.online_cents > net) warnings.push('Online is more than Total Income less Discounts (a tip?)')
        if (net != null && f.amount_cents && net !== f.amount_cents) warnings.push(f.discount_cents ? 'Total Income less Discounts differs from the receipt total (Total Income goes before the discount)' : 'Total Income differs from the receipt total')
        if (/\(check|\?/i.test(`${f.client_name || ''} ${f.pet_names || ''}`)) warnings.push('A name to check')
        const items = [].concat(r.items || []).slice(0, 60).map((x) => ({ item: clean(x && x.item, 120) || null, amount: money(x && x.amountCents) }))
        if (items.some((x) => Number.isNaN(x.amount))) issues.push('An item amount isn’t a number')
        out.items = items.filter((x) => !Number.isNaN(x.amount) && (x.item || x.amount))
        out.row.items = out.items.map((x) => ({ item: x.item || '', amountCents: x.amount }))
        if (out.items.length && f.amount_cents) {
          const sum = out.items.reduce((n, x) => n + (x.amount || 0), 0) - (f.discount_cents || 0)
          if (sum !== f.amount_cents) warnings.push(`Items less discount come to ₱${(sum / 100).toLocaleString('en-PH')}, not the receipt total`)
        }
      }
      if (kind === 'expenses') {
        if (!f.amount_cents && !f.description) issues.push('Empty row')
        if (oldExpenses.some((e) => e.day === r.day && e.amount_cents === f.amount_cents && sameText(e.description, f.description))) { out.status = 'skip'; out.reason = 'Already in the Ledger' }
        else if (oldExpenses.some((e) => e.day === r.day && e.amount_cents === f.amount_cents)) warnings.push('An expense of the same amount is already on this day: a duplicate?')
      }
      if (kind === 'remits') {
        const key = `${r.day}|${f.kind}`
        const label = f.kind === 'second' ? '2nd' : '1st'
        if (oldRemits.some((x) => x.day === r.day && x.kind === f.kind)) { out.status = 'skip'; out.reason = `There’s already a ${label} Remit for ${isDay(r.day) ? short(r.day) : 'that day'}. Change it on the page.` }
        else if (seen.remit.has(key)) { out.status = 'skip'; out.reason = `A second ${label} Remit for the same day` }
        seen.remit.add(key)
      }
      if (issues.length) { out.status = 'error'; out.reason = issues.join('. ') }
      out.fields = f
      plan[kind].push(out)
    })
  }

  // Each day's totals for the rows being added, to check against the paper summary.
  const byDay = {}
  const dayOf = (d) => (byDay[d] ||= { day: d, receipts: 0, income: 0, online: 0, expenses: 0, first: 0, second: 0 })
  for (const p of plan.lines) if (p.status === 'add') { const d = dayOf(p.day); d.receipts++; d.income += p.fields.income_cents != null ? p.fields.income_cents - (p.fields.discount_cents || 0) : 0; d.online += p.fields.online_cents || 0 }
  for (const p of plan.expenses) if (p.status === 'add') dayOf(p.day).expenses += p.fields.amount_cents || 0
  for (const p of plan.remits) if (p.status === 'add') dayOf(p.day)[p.fields.kind] += p.fields.amount_cents || 0
  const count = (s) => Object.values(plan).flat().filter((p) => p.status === s).length
  const summary = { add: count('add'), skip: count('skip'), error: count('error'), days: Object.values(byDay).sort((a, c) => a.day.localeCompare(c.day)) }

  let imported = 0
  if (b.commit && summary.add) {
    const who = `${staff.name} (import)`
    const added = (k) => plan[k].filter((p) => p.status === 'add').length
    const batch = await env.DB.prepare('INSERT INTO cash_imports (file, days, receipts, expenses, remits, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(clean(b.file, 120) || null, JSON.stringify([...new Set(Object.values(plan).flat().filter((p) => p.status === 'add').map((p) => p.day))].sort()), added('lines'), added('expenses'), added('remits'), staff.name).first()
    const stmts = []
    const nextSort = {}
    const sorts = days.length ? (await env.DB.prepare(`SELECT day, MAX(sort) AS s FROM cash_lines WHERE branch_id = 1 AND book = 'owner' AND day IN (${days.map(() => '?').join(', ')}) GROUP BY day`).bind(...days).all()).results : []
    for (const x of sorts) nextSort[x.day] = x.s || 0
    for (const kind of ['lines', 'expenses', 'remits']) {
      for (const p of plan[kind]) {
        if (p.status !== 'add') continue
        const f = { ...p.fields, day: p.day }
        if (kind === 'lines') f.sort = nextSort[p.day] = (nextSort[p.day] || 0) + 1
        f.created_by = who
        f.import_id = batch.id
        const cols = Object.keys(f)
        stmts.push(env.DB.prepare(`INSERT INTO ${TABLES[kind].table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => f[c])))
        // Its items: the batch runs in order, so the newest receipt of this import is the one just added.
        ;(p.items || []).forEach((x, n) => stmts.push(env.DB.prepare(`INSERT INTO cash_line_items (line_id, item, amount_cents, sort, created_by)
          VALUES ((SELECT MAX(id) FROM cash_lines WHERE import_id = ?), ?, ?, ?, ?)`).bind(batch.id, x.item, x.amount, n + 1, who)))
      }
    }
    await env.DB.batch(stmts)
    imported = stmts.length - Object.values(plan).flat().reduce((n, p) => n + (p.status === 'add' ? (p.items || []).length : 0), 0)
    await audit(env, staff.email, 'import', 'cash_import', batch.id, {
      file: clean(b.file, 120), receipts: plan.lines.filter((p) => p.status === 'add').length, expenses: plan.expenses.filter((p) => p.status === 'add').length,
      remits: plan.remits.filter((p) => p.status === 'add').length, skipped: summary.skip, errors: summary.error, days,
    })
  }
  for (const k of Object.keys(plan)) for (const p of plan[k]) { delete p.fields; delete p.items }
  return json({ plan, summary, imported })
}

async function listImports(env) {
  const { results } = await env.DB.prepare(`SELECT i.*,
      (SELECT COUNT(*) FROM cash_lines WHERE import_id = i.id AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM cash_expenses WHERE import_id = i.id AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM cash_remits WHERE import_id = i.id AND deleted_at IS NULL) AS left_rows,
      (SELECT COUNT(*) FROM cash_lines WHERE import_id = i.id AND deleted_at IS NULL AND updated_at IS NOT NULL) +
      (SELECT COUNT(*) FROM cash_expenses WHERE import_id = i.id AND deleted_at IS NULL AND updated_at IS NOT NULL) +
      (SELECT COUNT(*) FROM cash_remits WHERE import_id = i.id AND deleted_at IS NULL AND updated_at IS NOT NULL) AS edited_rows
    FROM cash_imports i WHERE i.branch_id = 1 ORDER BY i.id DESC LIMIT 20`).all()
  return json({ imports: results.map((r) => ({ id: r.id, file: r.file || '', days: JSON.parse(r.days || '[]'), receipts: r.receipts, expenses: r.expenses, remits: r.remits,
    createdAt: r.created_at, createdBy: r.created_by || '', undoneAt: r.undone_at, undoneBy: r.undone_by || '', leftRows: r.left_rows, editedRows: r.edited_rows })) })
}

async function undoImport(env, staff, id) {
  const imp = await env.DB.prepare('SELECT * FROM cash_imports WHERE id = ? AND branch_id = 1').bind(id).first()
  if (!imp) return fail(404, 'This import was not found. Reload the page.')
  if (imp.undone_at) return fail(409, 'This import was already undone.')
  const now = new Date().toISOString()
  const who = staff.name
  const res = await env.DB.batch([
    ...['cash_lines', 'cash_expenses', 'cash_remits'].map((t) => env.DB.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ? WHERE import_id = ? AND deleted_at IS NULL`).bind(now, `${who} (undo import)`, id)),
    env.DB.prepare('UPDATE cash_imports SET undone_at = ?, undone_by = ? WHERE id = ?').bind(now, who, id),
  ])
  const removed = res.slice(0, 3).reduce((n, r) => n + (r.meta?.changes || 0), 0)
  await audit(env, staff.email, 'undo', 'cash_import', id, { file: imp.file, removed })
  return json({ ok: true, removed, days: JSON.parse(imp.days || '[]') })
}

// ---------- Items of a receipt ----------
const itemShape = (i) => ({ id: i.id, lineId: i.line_id, item: i.item || '', amountCents: i.amount_cents })
async function itemRoute(env, staff, method, id, b, mine) {
  const now = new Date().toISOString()
  const ofMine = `line_id IN (SELECT id FROM cash_lines WHERE ${mine})`
  if (method === 'DELETE' && id) {
    await env.DB.prepare(`UPDATE cash_line_items SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL AND ${ofMine}`).bind(now, staff.name, id).run()
    await audit(env, staff.email, 'delete', 'cash_line_item', id)
    return json({ ok: true })
  }
  const amount = money(b.amountCents)
  if (Number.isNaN(amount)) return fail(400, 'Enter the amount as a number, e.g. 300.', { errors: { amountCents: 'Enter the amount as a number, e.g. 300.' } })
  const item = clean(b.item, 120) || null
  if (method === 'POST') {
    const line = await env.DB.prepare(`SELECT id FROM cash_lines WHERE id = ? AND branch_id = 1 AND deleted_at IS NULL AND ${mine}`).bind(Number(b.lineId) || 0).first()
    if (!line) return fail(404, 'This receipt was not found. Reload the page.')
    const row = await env.DB.prepare(`INSERT INTO cash_line_items (line_id, item, amount_cents, sort, created_by)
      VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM cash_line_items WHERE line_id = ?), ?) RETURNING *`).bind(line.id, item, amount, line.id, staff.name).first()
    await audit(env, staff.email, 'create', 'cash_line_item', row.id, { line: line.id })
    return json({ row: itemShape(row) }, 201)
  }
  if (method === 'PATCH' && id) {
    const row = await env.DB.prepare(`UPDATE cash_line_items SET item = ?, amount_cents = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL AND ${ofMine} RETURNING *`).bind(item, amount, now, staff.name, id).first()
    if (!row) return fail(404, 'This item was not found. Reload the page.')
    await audit(env, staff.email, 'update', 'cash_line_item', id)
    return json({ row: itemShape(row) })
  }
  return fail(405, 'Not allowed.')
}

// ---------- A receipt's photo ----------
async function photoRoute(env, staff, request, method, lineId, manager) {
  if (!lineId) return fail(404, 'Not found.')
  if (!env.PHOTOS) return fail(503, "Photo storage isn't connected yet.")
  const line = await env.DB.prepare('SELECT id, day, book, photo_key, photo_type FROM cash_lines WHERE id = ? AND branch_id = 1 AND deleted_at IS NULL').bind(lineId).first()
  if (!line) return fail(404, 'This receipt was not found. Reload the page.')
  if (method === 'GET') {
    if (!line.photo_key) return fail(404, 'This receipt has no photo.')
    const obj = await env.PHOTOS.get(line.photo_key)
    if (!obj) return fail(404, "This photo hasn't been uploaded yet.")
    return new Response(obj.body, { headers: { 'Content-Type': line.photo_type || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Length': String(obj.size) } })
  }
  if (method !== 'POST') return fail(405, 'Not allowed.')
  if (!manager && line.book !== 'staff') return fail(403, 'Only an owner or admin can change the Ledger.')
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return fail(400, 'Upload a photo (JPG, PNG or WebP).')
  const body = await request.arrayBuffer()
  if (!body.byteLength) return fail(400, 'The photo was empty. Try again.')
  if (body.byteLength > PHOTO_MAX) return fail(400, 'This photo is too big (over 8 MB). Try again: the app makes photos smaller first.')
  const key = `receipts/${line.day}/${line.id}-${Date.now()}.${type.split('/')[1].replace('jpeg', 'jpg')}`
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType: type } })
  await env.DB.prepare('UPDATE cash_lines SET photo_key = ?, photo_type = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(key, type, new Date().toISOString(), staff.name, line.id).run()
  await audit(env, staff.email, line.photo_key ? 'replace_photo' : 'add_photo', 'cash_line', line.id)
  return json({ ok: true })
}

// ---------- The front desk's typed summary ----------
const listOf = (v, withCode) => [].concat(Array.isArray(v) ? v : []).slice(0, 80).map((x) => {
  const amount = money(x && x.amountCents)
  const row = { name: clean(x && x.name, 80), amountCents: Number.isNaN(amount) ? null : amount }
  if (withCode) row.code = clean(x && x.code, 8).toUpperCase()
  return row
}).filter((x) => x.name || x.amountCents != null)
function summaryShape(r) {
  return { day: r.day, incomeCents: r.income_cents, expensesCents: r.expenses_cents, onlineCents: r.online_cents, firstRemitCents: r.first_remit_cents,
    cashOnHandCents: r.cash_on_hand_cents, onlineList: JSON.parse(r.online_list || '[]'), groomingList: JSON.parse(r.grooming_list || '[]'), note: r.note || '',
    updatedBy: r.updated_by || r.created_by || '', updatedAt: r.updated_at || r.created_at }
}
async function saveSummary(env, staff, b) {
  if (!isDay(b.day)) return fail(400, 'Choose the day.')
  const errors = {}
  const f = {}
  for (const [k, col, label] of [['incomeCents', 'income_cents', 'Total Income'], ['expensesCents', 'expenses_cents', 'Less Expenses'], ['onlineCents', 'online_cents', 'Less Online'],
    ['firstRemitCents', 'first_remit_cents', 'Less 1st Remit'], ['cashOnHandCents', 'cash_on_hand_cents', 'Cash On Hand']]) {
    const v = money(b[k])
    if (Number.isNaN(v)) errors[k] = `Enter ${label} as a number, e.g. 1500.`
    f[col] = Number.isNaN(v) ? null : v
  }
  if (Object.keys(errors).length) return fail(400, Object.values(errors)[0], { errors })
  f.online_list = JSON.stringify(listOf(b.onlineList, true))
  f.grooming_list = JSON.stringify(listOf(b.groomingList, false))
  f.note = clean(b.note, 300) || null
  const now = new Date().toISOString()
  const old = await env.DB.prepare('SELECT id FROM cash_summaries WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL').bind(b.day).first()
  const cols = Object.keys(f)
  const row = old
    ? await env.DB.prepare(`UPDATE cash_summaries SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *`).bind(...cols.map((c) => f[c]), now, staff.name, old.id).first()
    : await env.DB.prepare(`INSERT INTO cash_summaries (day, ${cols.join(', ')}, created_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?) RETURNING *`).bind(b.day, ...cols.map((c) => f[c]), staff.name).first()
  await audit(env, staff.email, old ? 'update' : 'create', 'cash_summary', row.id, { day: b.day })
  return json({ summary: summaryShape(row) })
}

// The staff photo for each receipt number in a list of Ledger rows: { '05337': lineId }.
async function photosByNumber(env, rows) {
  const nums = [...new Set(rows.flatMap((r) => [r.receipt_no, r.receipt_qr]).filter(Boolean))].slice(0, 400)
  const out = {}
  for (let i = 0; i < nums.length; i += 40) {
    const part = nums.slice(i, i + 40)
    const q = part.map(() => '?').join(', ')
    const { results } = await env.DB.prepare(`SELECT id, receipt_no, receipt_qr FROM cash_lines WHERE branch_id = 1 AND book = 'staff' AND deleted_at IS NULL AND photo_key IS NOT NULL
      AND (receipt_no IN (${q}) OR receipt_qr IN (${q})) ORDER BY id`).bind(...part, ...part).all()
    for (const r of results) { if (r.receipt_no) out[r.receipt_no] = r.id; if (r.receipt_qr) out[r.receipt_qr] = r.id }
  }
  return out
}

// Copy from Staff (owners and admins): staff's receipts (with their items) and expenses for a day, into the Ledger,
// through the same checks as Import File (receipts already in the Ledger are skipped; Undo Import takes them out).
async function copyStaffDay(env, staff, b) {
  if (!isDay(b.day)) return fail(400, 'Choose the day.')
  const [l, e, it] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM cash_lines WHERE branch_id = 1 AND book = 'staff' AND day = ? AND deleted_at IS NULL ORDER BY sort, id").bind(b.day),
    env.DB.prepare("SELECT * FROM cash_expenses WHERE branch_id = 1 AND book = 'staff' AND day = ? AND deleted_at IS NULL ORDER BY id").bind(b.day),
    env.DB.prepare("SELECT i.* FROM cash_line_items i JOIN cash_lines l ON l.id = i.line_id WHERE l.book = 'staff' AND l.day = ? AND l.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY i.sort, i.id").bind(b.day),
  ])
  const lines = l.results.map((x, n) => ({ ...TABLES.lines.shape({ ...x, items: it.results.filter((i) => i.line_id === x.id).map(itemShape) }), sheet: 'Staff', line: n + 1 }))
    .filter((x) => x.receiptNo || x.receiptQr || x.clientName || x.amountCents || x.items.length)
  const expenses = e.results.map((x, n) => ({ ...TABLES.expenses.shape(x), sheet: 'Staff Expenses', line: n + 1 }))
  if (!lines.length && !expenses.length) return fail(400, `Staff haven’t typed anything for ${short(b.day)} yet.`)
  return importRows(env, staff, { file: `Copied from staff’s Receipts, ${short(b.day)}`, commit: !!b.commit, lines, expenses, remits: [] })
}
