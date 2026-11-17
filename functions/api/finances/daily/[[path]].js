// Finances ▸ Ledger (owners and admins): the cash ledger, typed in like a spreadsheet. Math: lib/daily-cash.js.
//   GET    /api/finances/daily?from=YYYY-MM-DD&to=YYYY-MM-DD -> receipts, expenses and remits in that range
//   POST   /api/finances/daily/lines     {day, receiptNo, receiptQr, clientName, petNames, note, amountCents (Total Per Receipt),
//                                          onlineCents, depositCents, balanceCents, incomeCents, commissionCents}
//   PATCH  /api/finances/daily/lines/:id (the same)            DELETE -> soft-deleted
//   POST   /api/finances/daily/expenses  {day, category, description, amountCents}   PATCH / DELETE /expenses/:id
//   POST   /api/finances/daily/remits    {day, kind: first|second, amountCents, remittedBy}   PATCH / DELETE /remits/:id
//   POST   /api/finances/daily/import    {file, commit, lines, expenses, remits} (rows from lib/ledger-import.js)
//          -> what each row will do (add / skip: already in the Ledger / error) and each day's totals; with
//             commit: true, adds the "add" rows in one go and logs it. Never changes or removes existing rows.
//   GET    /api/finances/daily/imports           -> the last 20 imports, with how many of their rows are still there
//   POST   /api/finances/daily/imports/:id/undo  -> Undo Import: soft-deletes the rows that import added (only those)
// Rows can be saved half-filled (a spreadsheet is typed cell by cell); blanks count as 0.

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'
import { EXPENSE_TYPES } from '../../../../lib/daily-cash.js'

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
const money = (v) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 1e10 ? n : NaN }
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

const TABLES = {
  lines: {
    table: 'cash_lines', entity: 'cash_line',
    fields(b, errors) {
      const m = {}
      for (const [k, col, label] of [['amountCents', 'amount_cents', 'Total Per Receipt'], ['onlineCents', 'online_cents', 'Online Payments'], ['depositCents', 'deposit_cents', 'Deposit'],
        ['balanceCents', 'balance_cents', 'Balance'], ['incomeCents', 'income_cents', 'Total Income'], ['commissionCents', 'commission_cents', 'Commissions']]) {
        const v = money(b[k])
        if (Number.isNaN(v)) errors[k] = `Enter ${label} as a number, e.g. 1500.`
        m[col] = Number.isNaN(v) ? null : v
      }
      return { receipt_no: clean(b.receiptNo, 40) || null, receipt_qr: clean(b.receiptQr, 40) || null, client_name: clean(b.clientName, 120) || null,
        pet_names: clean(b.petNames, 200) || null, note: clean(b.note, 300) || null, ...m, amount_cents: m.amount_cents ?? 0 }
    },
    shape: (r) => ({ id: r.id, day: r.day, receiptNo: r.receipt_no || '', receiptQr: r.receipt_qr || '', clientName: r.client_name || '', petNames: r.pet_names || '',
      note: r.note || '', amountCents: r.amount_cents || null, onlineCents: r.online_cents, depositCents: r.deposit_cents, balanceCents: r.balance_cents,
      incomeCents: r.income_cents, commissionCents: r.commission_cents }),
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
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can open the Ledger.')
  const [what, rawId, action] = [].concat(params.path || [])
  const id = rawId ? Number(rawId) : null
  const method = request.method
  const who = data.staff.name
  const now = new Date().toISOString()

  if (method === 'GET' && !what) {
    const u = new URL(request.url).searchParams
    const from = u.get('from') || manilaToday()
    const to = u.get('to') || from
    if (!isDay(from) || !isDay(to) || from > to) return fail(400, 'Choose the dates to show.')
    const q = (t, order) => env.DB.prepare(`SELECT * FROM ${t} WHERE branch_id = 1 AND day BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY day, ${order}`).bind(from, to)
    const [l, e, r] = await env.DB.batch([q('cash_lines', 'sort, id'), q('cash_expenses', 'id'), q('cash_remits', 'kind, id')])
    return json({ from, to, lines: l.results.map(TABLES.lines.shape), expenses: e.results.map(TABLES.expenses.shape), remits: r.results.map(TABLES.remits.shape) })
  }

  if (what === 'import' && method === 'POST') return importRows(env, data.staff, (await readJson(request)) || {})
  if (what === 'imports' && method === 'GET' && !id) return listImports(env)
  if (what === 'imports' && method === 'POST' && id && action === 'undo') return undoImport(env, data.staff, id)
  const t = TABLES[what]
  if (!t) return fail(404, 'Not found.')
  if (method === 'DELETE' && id) {
    await env.DB.prepare(`UPDATE ${t.table} SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL`).bind(now, who, id).run()
    await audit(env, data.staff.email, 'delete', t.entity, id)
    return json({ ok: true })
  }
  const b = (await readJson(request)) || {}
  const errors = {}
  const f = t.fields(b, errors)
  if (!isDay(b.day)) errors.day = 'Enter the date.'
  if (Object.keys(errors).length) return fail(400, Object.values(errors)[0], { errors })
  f.day = b.day
  const cols = Object.keys(f)
  if (method === 'POST') {
    const extra = what === 'lines' ? ', sort' : ''
    const extraVal = what === 'lines' ? ', (SELECT COALESCE(MAX(sort), 0) + 1 FROM cash_lines WHERE day = ?)' : ''
    const row = await env.DB.prepare(`INSERT INTO ${t.table} (${cols.join(', ')}${extra}, created_by) VALUES (${cols.map(() => '?').join(', ')}${extraVal}, ?) RETURNING *`)
      .bind(...cols.map((c) => f[c]), ...(what === 'lines' ? [f.day] : []), who).first()
    await audit(env, data.staff.email, 'create', t.entity, row.id, { day: f.day })
    return json({ row: t.shape(row) }, 201)
  }
  if (method === 'PATCH' && id) {
    const row = await env.DB.prepare(`UPDATE ${t.table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL RETURNING *`)
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
    const { results } = await env.DB.prepare(`SELECT day, receipt_no, receipt_qr FROM cash_lines WHERE branch_id = 1 AND deleted_at IS NULL AND (receipt_no IN (${q}) OR receipt_qr IN (${q}))`).bind(...part, ...part).all()
    for (const r of results) { if (r.receipt_no) have.no.set(r.receipt_no, r.day); if (r.receipt_qr) have.qr.set(r.receipt_qr, r.day) }
  }
  let oldExpenses = []
  let oldRemits = []
  if (days.length) {
    const q = days.map(() => '?').join(', ')
    ;[oldExpenses, oldRemits] = (await env.DB.batch([
      env.DB.prepare(`SELECT day, description, amount_cents FROM cash_expenses WHERE branch_id = 1 AND deleted_at IS NULL AND day IN (${q})`).bind(...days),
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
        if (f.online_cents && f.income_cents != null && f.online_cents > f.income_cents) warnings.push('Online is more than Total Income (a tip?)')
        if (f.income_cents != null && f.amount_cents && f.income_cents !== f.amount_cents) warnings.push('Total Income differs from the receipt total')
        if (/\(check|\?/i.test(`${f.client_name || ''} ${f.pet_names || ''}`)) warnings.push('A name to check')
      }
      if (kind === 'expenses') {
        if (!f.amount_cents && !f.description) issues.push('Empty row')
        if (oldExpenses.some((e) => e.day === r.day && e.amount_cents === f.amount_cents && sameText(e.description, f.description))) { out.status = 'skip'; out.reason = 'Already in the Ledger' }
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
  for (const p of plan.lines) if (p.status === 'add') { const d = dayOf(p.day); d.receipts++; d.income += p.fields.income_cents || 0; d.online += p.fields.online_cents || 0 }
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
    const sorts = days.length ? (await env.DB.prepare(`SELECT day, MAX(sort) AS s FROM cash_lines WHERE branch_id = 1 AND day IN (${days.map(() => '?').join(', ')}) GROUP BY day`).bind(...days).all()).results : []
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
      }
    }
    await env.DB.batch(stmts)
    imported = stmts.length
    await audit(env, staff.email, 'import', 'cash_import', batch.id, {
      file: clean(b.file, 120), receipts: plan.lines.filter((p) => p.status === 'add').length, expenses: plan.expenses.filter((p) => p.status === 'add').length,
      remits: plan.remits.filter((p) => p.status === 'add').length, skipped: summary.skip, errors: summary.error, days,
    })
  }
  for (const k of Object.keys(plan)) for (const p of plan[k]) delete p.fields
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
