// Finances ▸ Ledger: the cash ledger for every staff member, typed in like a spreadsheet or read from receipt photos.
// Math: lib/daily-cash.js. Photo reading: lib/receipt-reader.js.
// One record per day. Each receipt goes through three stages: draft (read by the app or just added) -> staff
// (approved by staff) -> owner (approved by an owner or admin: then locked for staff). Every change to a receipt is
// kept in cash_line_history. Commissions and Owner Notes are for owners and admins only (left out of what staff get,
// and ignored when staff save). Staff read one day at a time; several days, imports, Clear/Restore Day and the
// Overview are for owners and admins.
//   GET    /api/finances/daily?from=YYYY-MM-DD&to=YYYY-MM-DD -> receipts, expenses, remits, the day's status
//   POST   /api/finances/daily/lines     {day, receiptNo, receiptQr, clientName, petNames, note (Notes), amountCents (Total Per
//                                          Receipt), discountCents, onlineCents, depositCents, balanceCents, incomeCents,
//                                          commissionCents, paidWith, issueNote, ownerNote} -> a draft
//   PATCH  /api/finances/daily/lines/:id (only the fields sent)   DELETE -> soft-deleted
//   GET    /api/finances/daily/lines/:id/history -> what the app read and who changed what
//   POST   /api/finances/daily/approve   {ids}: staff approve drafts; owners and admins approve for the owners
//   POST   /api/finances/daily/reopen    {id} (owners and admins): back to staff's stage, so it can be changed
//   POST   /api/finances/daily/read/:id  {again}: read the receipt's photo with Claude and fill the empty fields
//   POST   /api/finances/daily/day       {day, step: staff|owner, done}: Mark Day Done (staff) / Day Checked (owners)
//   POST   /api/finances/daily/items     {lineId, item, amountCents}: one item of a receipt   PATCH / DELETE /items/:id
//   POST   /api/finances/daily/expenses  {day, category, description, amountCents}   PATCH / DELETE /expenses/:id
//   POST   /api/finances/daily/remits    {day, kind: first|second, amountCents, remittedBy}   PATCH / DELETE /remits/:id
//   POST   /api/finances/daily/import    {file, commit, lines, expenses, remits} (rows from lib/ledger-import.js)
//          -> what each row will do (add / skip: already in the Ledger / error) and each day's totals; with
//             commit: true, adds the "add" rows in one go (approved by the owner who imported) and logs it.
//   GET    /api/finances/daily/overview?from&to&prevFrom&prevTo -> the Overview's Ledger section (lib/ledger-overview.js)
//   GET    /api/finances/daily/photos/:lineId   POST (the image as the body) -> a receipt's photo (R2)
//   POST   /api/finances/daily/clear   {day, confirm}: Clear This Day (owners and admins): marks the day's receipts,
//          expenses and remits removed, tagged so that
//   POST   /api/finances/daily/restore {day, tag} puts exactly those back. GET of one day says if it was cleared.
//   GET    /api/finances/daily/imports           -> the last 20 imports, with how many of their rows are still there
//   POST   /api/finances/daily/imports/:id/undo  -> Undo Import: soft-deletes the rows that import added (only those)
// Rows can be saved half-filled (a spreadsheet is typed cell by cell); blanks count as 0.

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'
import { EXPENSE_TYPES } from '../../../../lib/daily-cash.js'
import { ledgerOverview } from '../../../../lib/ledger-overview.js'
import { readReceipt, readingToRow } from '../../../../lib/receipt-reader.js'

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
const money = (v) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 1e10 ? n : NaN }
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

const PAID_WITH = ['cash', 'gcash', 'bank', 'maribank', 'card', 'qrph', 'none']
const MANAGER_ONLY = ['import', 'imports', 'overview', 'clear', 'restore', 'reopen']
const OWNER_ONLY = ['commission_cents', 'owner_note']
const LOCKED = 'An owner has approved this receipt, so it can’t be changed here. Ask an owner if something needs fixing.'
const PHOTO_MAX = 8 * 1024 * 1024
// cash_lines column -> request field. All of them are kept in the receipt's history except the photo's rotation.
const LINE_KEYS = { receipt_no: 'receiptNo', receipt_qr: 'receiptQr', client_name: 'clientName', pet_names: 'petNames', note: 'note', amount_cents: 'amountCents',
  discount_cents: 'discountCents', online_cents: 'onlineCents', deposit_cents: 'depositCents', balance_cents: 'balanceCents', income_cents: 'incomeCents',
  commission_cents: 'commissionCents', paid_with: 'paidWith', issue_note: 'issueNote', owner_note: 'ownerNote', photo_rotate: 'photoRotate' }
const KEY_COL = Object.fromEntries(Object.entries(LINE_KEYS).map(([c, k]) => [k, c]))
const STAGE_NAME = { draft: 'Read by App', staff: 'Approved by Staff', owner: 'Approved by Owner' }

function aiShape(raw, manager) {
  if (!raw) return null
  let a
  try { a = JSON.parse(raw) } catch { return null }
  if (a.error) return { error: a.error, readAt: a.at }
  const r = a.reading || {}
  const { fields = {}, items = [] } = readingToRow(r)
  return {
    readAt: a.at, notReceipt: r.is_receipt === false, date: r.date || '', unclear: r.unclear || [],
    values: Object.fromEntries(Object.entries(fields).map(([c, v]) => [LINE_KEYS[c], v ?? (c.endsWith('_cents') ? null : '')])),
    items: items.map((x) => ({ item: x.item || '', amountCents: x.amount_cents })),
    ...(manager ? { model: a.model, costUsd: a.costUsd } : {}),
  }
}

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
        paid_with: PAID_WITH.includes(b.paidWith) ? b.paidWith : null, issue_note: clean(b.issueNote, 300) || null, owner_note: clean(b.ownerNote, 300) || null,
        photo_rotate: [90, 180, 270].includes(Number(b.photoRotate)) ? Number(b.photoRotate) : 0 }
    },
    shape: (r, manager = true) => ({ id: r.id, day: r.day, receiptNo: r.receipt_no || '', receiptQr: r.receipt_qr || '', clientName: r.client_name || '', petNames: r.pet_names || '',
      note: r.note || '', amountCents: r.amount_cents || null, discountCents: r.discount_cents ?? null, onlineCents: r.online_cents, depositCents: r.deposit_cents, balanceCents: r.balance_cents,
      incomeCents: r.income_cents, paidWith: r.paid_with || '', photo: !!r.photo_key, photoRotate: r.photo_rotate || 0, items: r.items || [],
      stage: r.stage || 'owner', staffApprovedAt: r.staff_approved_at || null, staffApprovedBy: r.staff_approved_by || '', ownerApprovedAt: r.owner_approved_at || null,
      ownerApprovedBy: r.owner_approved_by || '', issueNote: r.issue_note || '', ai: aiShape(r.ai_reading, manager), dupes: r.dupes || [],
      ...(manager ? { commissionCents: r.commission_cents, ownerNote: r.owner_note || '' } : {}) }),
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

// ---------- A receipt's history ----------
const asText = (v) => (v === null || v === undefined || v === '' ? null : String(v))
const histStmt = (env, lineId, field, oldV, newV, source, by) => env.DB.prepare('INSERT INTO cash_line_history (line_id, field, old_value, new_value, source, by_name) VALUES (?, ?, ?, ?, ?, ?)')
  .bind(lineId, field, asText(oldV), asText(newV), source, by)
// Statements logging each changed column (not the photo's rotation).
function changeStmts(env, old, next, source, by) {
  return Object.keys(next).filter((c) => LINE_KEYS[c] && c !== 'photo_rotate' && asText(old[c]) !== asText(next[c]) && !(c === 'amount_cents' && !old[c] && !next[c]))
    .map((c) => histStmt(env, old.id, LINE_KEYS[c], c === 'amount_cents' && !old[c] ? null : old[c], next[c], source, by))
}
const itemText = (i) => (i ? [i.item, i.amount_cents != null ? `₱${(i.amount_cents / 100).toLocaleString('en-PH')}` : ''].filter(Boolean).join(' ') || '(blank)' : null)

async function lineById(env, id) {
  return env.DB.prepare('SELECT * FROM cash_lines WHERE id = ? AND branch_id = 1 AND deleted_at IS NULL').bind(Number(id) || 0).first()
}

// Other receipts with the same number (another day, or twice on the same day): { lineId: [{day, id}] }.
async function dupesOf(env, rows) {
  const nums = [...new Set(rows.flatMap((r) => [r.receipt_no, r.receipt_qr]).filter(Boolean))].slice(0, 600)
  const all = []
  for (let i = 0; i < nums.length; i += 40) {
    const part = nums.slice(i, i + 40)
    const q = part.map(() => '?').join(', ')
    all.push(...(await env.DB.prepare(`SELECT id, day, receipt_no, receipt_qr FROM cash_lines WHERE branch_id = 1 AND deleted_at IS NULL AND (receipt_no IN (${q}) OR receipt_qr IN (${q}))`).bind(...part, ...part).all()).results)
  }
  const out = {}
  for (const r of rows) {
    const d = all.filter((x) => x.id !== r.id && ((r.receipt_no && x.receipt_no === r.receipt_no) || (r.receipt_qr && x.receipt_qr === r.receipt_qr)))
    if (d.length) out[r.id] = d.map((x) => ({ id: x.id, day: x.day }))
  }
  return out
}

const dayShape = (d) => ({ staffDoneAt: d?.staff_done_at || null, staffDoneBy: d?.staff_done_by || '', ownerDoneAt: d?.owner_done_at || null, ownerDoneBy: d?.owner_done_by || '' })

export async function onRequest({ request, env, params, data }) {
  const [what, rawId, action] = [].concat(params.path || [])
  const manager = canManage(data.staff)
  if (!manager && MANAGER_ONLY.includes(what)) return fail(403, 'Only an owner or admin can do this.')
  const id = rawId ? Number(rawId) : null
  const method = request.method
  const who = data.staff.name
  const source = manager ? 'owner' : 'staff'
  const now = new Date().toISOString()

  if (method === 'GET' && !what) {
    const u = new URL(request.url).searchParams
    const from = u.get('from') || manilaToday()
    const to = u.get('to') || from
    if (!isDay(from) || !isDay(to) || from > to) return fail(400, 'Choose the dates to show.')
    if (!manager && from !== to) return fail(403, 'Choose one day at a time.')
    const q = (t, order) => env.DB.prepare(`SELECT * FROM ${t} WHERE branch_id = 1 AND day BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY day, ${order}`).bind(from, to)
    const [l, e, r, it, days] = await env.DB.batch([q('cash_lines', 'sort, id'), q('cash_expenses', 'id'), q('cash_remits', 'kind, id'),
      env.DB.prepare('SELECT i.* FROM cash_line_items i JOIN cash_lines l ON l.id = i.line_id WHERE l.branch_id = 1 AND l.day BETWEEN ? AND ? AND l.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY i.sort, i.id').bind(from, to),
      env.DB.prepare('SELECT * FROM cash_days WHERE branch_id = 1 AND day BETWEEN ? AND ?').bind(from, to)])
    const items = {}
    for (const i of it.results) (items[i.line_id] ||= []).push(itemShape(i))
    const dupes = await dupesOf(env, l.results)
    const sum = from === to ? await env.DB.prepare('SELECT * FROM cash_summaries WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL').bind(from).first() : null
    const cleared = manager && from === to ? await lastClear(env, from) : null
    return json({ from, to, cleared, summary: sum ? summaryShape(sum) : null, reading: !!env.ANTHROPIC_API_KEY,
      days: Object.fromEntries(days.results.map((d) => [d.day, dayShape(d)])),
      lines: l.results.map((x) => TABLES.lines.shape({ ...x, items: items[x.id], dupes: dupes[x.id] }, manager)),
      expenses: e.results.map(TABLES.expenses.shape), remits: r.results.map(TABLES.remits.shape) })
  }

  if (what === 'photos') return photoRoute(env, data.staff, request, method, id, manager)
  if (what === 'read' && method === 'POST') return readRoute(env, data.staff, id, (await readJson(request)) || {}, manager)
  if (what === 'approve' && method === 'POST') return approveRoute(env, data.staff, (await readJson(request)) || {}, manager)
  if (what === 'reopen' && method === 'POST') return reopenRoute(env, data.staff, (await readJson(request)) || {})
  if (what === 'day' && method === 'POST') return dayRoute(env, data.staff, (await readJson(request)) || {}, manager)
  if (what === 'lines' && id && action === 'history' && method === 'GET') return historyRoute(env, id, manager)
  if (what === 'clear' && method === 'POST') return clearDay(env, data.staff, (await readJson(request)) || {})
  if (what === 'restore' && method === 'POST') return restoreDay(env, data.staff, (await readJson(request)) || {})
  if (what === 'summary' && method === 'PUT') return saveSummary(env, data.staff, (await readJson(request)) || {})
  if (what === 'items') return itemRoute(env, data.staff, method, id, method === 'DELETE' ? {} : (await readJson(request)) || {}, manager)
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

  if (what === 'lines' && id && (method === 'DELETE' || method === 'PATCH')) {
    const old = await lineById(env, id)
    if (!old) return fail(404, 'This row was not found. Reload the page.')
    const b = method === 'PATCH' ? (await readJson(request)) || {} : {}
    const onlyRotate = Object.keys(b).every((k) => k === 'photoRotate' || k === 'day')
    if (!manager && old.stage === 'owner' && !onlyRotate) return fail(403, LOCKED)
    if (method === 'DELETE') {
      await env.DB.batch([env.DB.prepare('UPDATE cash_lines SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(now, who, id),
        histStmt(env, id, 'removed', null, 'Removed', source, who)])
      await audit(env, data.staff.email, 'delete', t.entity, id)
      return json({ ok: true })
    }
    const errors = {}
    const all = t.fields(b, errors)
    if (Object.keys(errors).length) return fail(400, Object.values(errors)[0], { errors })
    // Only the fields sent; staff never change the owners' columns.
    const f = Object.fromEntries(Object.entries(all).filter(([c]) => LINE_KEYS[c] in b && (manager || !OWNER_ONLY.includes(c))))
    if (!Object.keys(f).length) return json({ row: t.shape({ ...old, items: await itemsOf(env, id) }, manager) })
    const cols = Object.keys(f)
    const [res] = await env.DB.batch([
      env.DB.prepare(`UPDATE cash_lines SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *`).bind(...cols.map((c) => f[c]), now, who, id),
      ...changeStmts(env, old, f, source, who),
    ])
    await audit(env, data.staff.email, 'update', t.entity, id)
    return json({ row: t.shape({ ...res.results[0], items: await itemsOf(env, id) }, manager) })
  }

  if (method === 'DELETE' && id) {
    const gone = await env.DB.prepare(`UPDATE ${t.table} SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL`).bind(now, who, id).run()
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
  if (what === 'lines') {
    if (!manager) for (const c of OWNER_ONLY) delete f[c]
    f.stage = 'draft'
  }
  const cols = Object.keys(f)
  if (method === 'POST') {
    const extra = what === 'lines' ? ', sort' : ''
    const extraVal = what === 'lines' ? ', (SELECT COALESCE(MAX(sort), 0) + 1 FROM cash_lines WHERE day = ?)' : ''
    const row = await env.DB.prepare(`INSERT INTO ${t.table} (${cols.join(', ')}${extra}, created_by) VALUES (${cols.map(() => '?').join(', ')}${extraVal}, ?) RETURNING *`)
      .bind(...cols.map((c) => f[c]), ...(what === 'lines' ? [f.day] : []), who).first()
    if (what === 'lines') await histStmt(env, row.id, 'added', null, 'Added', source, who).run()
    await audit(env, data.staff.email, 'create', t.entity, row.id, { day: f.day })
    return json({ row: t.shape(row, manager) }, 201)
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

async function itemsOf(env, lineId) {
  return (await env.DB.prepare('SELECT * FROM cash_line_items WHERE line_id = ? AND deleted_at IS NULL ORDER BY sort, id').bind(lineId).all()).results.map(itemShape)
}

// ---------- Approve / Reopen / History ----------
async function approveRoute(env, staff, b, manager) {
  const ids = [...new Set([].concat(b.ids || []).map(Number).filter(Boolean))].slice(0, 200)
  if (!ids.length) return fail(400, 'Choose the receipts to approve.')
  const now = new Date().toISOString()
  const q = ids.map(() => '?').join(', ')
  const { results } = await env.DB.prepare(`SELECT id, stage FROM cash_lines WHERE branch_id = 1 AND deleted_at IS NULL AND id IN (${q})`).bind(...ids).all()
  const todo = results.filter((r) => (manager ? r.stage !== 'owner' : r.stage === 'draft'))
  if (!todo.length) return json({ approved: 0 })
  const to = manager ? 'owner' : 'staff'
  const stmts = todo.flatMap((r) => [
    env.DB.prepare(`UPDATE cash_lines SET stage = ?, ${manager ? 'owner' : 'staff'}_approved_at = ?, ${manager ? 'owner' : 'staff'}_approved_by = ? WHERE id = ?`).bind(to, now, staff.name, r.id),
    histStmt(env, r.id, 'stage', STAGE_NAME[r.stage], STAGE_NAME[to], manager ? 'owner' : 'staff', staff.name),
  ])
  await env.DB.batch(stmts)
  await audit(env, staff.email, 'approve', 'cash_line', null, { ids: todo.map((r) => r.id), stage: to })
  return json({ approved: todo.length, ids: todo.map((r) => r.id), stage: to, at: now, by: staff.name })
}

async function reopenRoute(env, staff, b) {
  const line = await lineById(env, b.id)
  if (!line) return fail(404, 'This receipt was not found. Reload the page.')
  if (line.stage !== 'owner') return json({ ok: true })
  const to = line.staff_approved_at ? 'staff' : 'draft'
  await env.DB.batch([
    env.DB.prepare('UPDATE cash_lines SET stage = ?, owner_approved_at = NULL, owner_approved_by = NULL WHERE id = ?').bind(to, line.id),
    histStmt(env, line.id, 'stage', STAGE_NAME.owner, `${STAGE_NAME[to]} (reopened)`, 'owner', staff.name),
  ])
  await audit(env, staff.email, 'reopen', 'cash_line', line.id)
  return json({ ok: true, stage: to })
}

async function historyRoute(env, id, manager) {
  const line = await env.DB.prepare('SELECT id, created_at, created_by FROM cash_lines WHERE id = ? AND branch_id = 1').bind(id).first()
  if (!line) return fail(404, 'This receipt was not found. Reload the page.')
  const { results } = await env.DB.prepare('SELECT * FROM cash_line_history WHERE line_id = ? ORDER BY id').bind(id).all()
  const hidden = manager ? [] : ['commissionCents', 'ownerNote']
  return json({ history: results.filter((h) => !hidden.includes(h.field)).map((h) => {
    let value = h.new_value
    if (h.field === 'staff_version' && value) { try { value = JSON.parse(value) } catch { /* shown as text */ } }
    return { id: h.id, field: h.field, oldValue: h.old_value, newValue: value, source: h.source, by: h.by_name || '', at: h.at }
  }), created: { at: line.created_at, by: line.created_by || '' } })
}

// ---------- Mark Day Done (staff) / Day Checked (owners and admins) ----------
async function dayRoute(env, staff, b, manager) {
  if (!isDay(b.day)) return fail(400, 'Choose the day.')
  const step = b.step === 'owner' ? 'owner' : 'staff'
  if (step === 'owner' && !manager) return fail(403, 'Only an owner or admin can do this.')
  const done = b.done !== false
  if (done) {
    const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM cash_lines WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL AND
      ${step === 'staff' ? "stage = 'draft'" : "stage != 'owner' AND COALESCE(issue_note, '') = ''"}`).bind(b.day).first()
    if (open?.n) return fail(400, step === 'staff'
      ? `Check and approve the ${open.n === 1 ? 'receipt' : `${open.n} receipts`} still marked Read by App first (or remove ${open.n === 1 ? 'it' : 'them'}).`
      : `Approve the ${open.n === 1 ? 'receipt' : `${open.n} receipts`} still waiting, or add a note to discuss ${open.n === 1 ? 'it' : 'them'} tomorrow.`)
  }
  const now = new Date().toISOString()
  const row = await env.DB.prepare(`INSERT INTO cash_days (branch_id, day, ${step}_done_at, ${step}_done_by) VALUES (1, ?1, ?2, ?3)
    ON CONFLICT (branch_id, day) DO UPDATE SET ${step}_done_at = ?2, ${step}_done_by = ?3 RETURNING *`).bind(b.day, done ? now : null, done ? staff.name : null).first()
  await audit(env, staff.email, done ? `${step}_day_done` : `${step}_day_reopened`, 'cash_day', row.id, { day: b.day })
  return json({ day: dayShape(row) })
}

// ---------- Read a receipt's photo (Claude) ----------
// Fills only the fields still empty (what someone typed stays), adds the items if the receipt has none, keeps what
// was read (shown next to the row, and in its history) and leaves the row a draft for staff to check.
async function readRoute(env, staff, id, b, manager) {
  const line = await lineById(env, id)
  if (!line) return fail(404, 'This receipt was not found. Reload the page.')
  if (line.stage === 'owner') return fail(409, 'An owner has approved this receipt already.')
  if (!line.photo_key) return fail(400, 'This receipt has no photo to read.')
  if (line.ai_read_at && !b.again) return json({ row: TABLES.lines.shape({ ...line, items: await itemsOf(env, id) }, manager) })
  if (!env.PHOTOS) return fail(503, "Photo storage isn't connected yet.")
  const obj = await env.PHOTOS.get(line.photo_key)
  if (!obj) return fail(404, "This photo hasn't been uploaded yet.")
  const now = new Date().toISOString()
  let got
  try {
    got = await readReceipt(env, await obj.arrayBuffer(), line.photo_type)
  } catch (err) {
    if (!line.ai_reading) await env.DB.prepare('UPDATE cash_lines SET ai_reading = ? WHERE id = ?').bind(JSON.stringify({ error: err.message, at: now }), id).run()
    await audit(env, staff.email, 'read_photo_failed', 'cash_line', id, { detail: err.detail || err.message, costUsd: err.costUsd || 0 })
    return fail(err.status || 502, err.message)
  }
  const { fields, items } = readingToRow(got.reading)
  const empty = (c) => line[c] === null || line[c] === '' || (c === 'amount_cents' && !line[c])
  const fill = Object.fromEntries(Object.entries(fields).filter(([c, v]) => v !== null && v !== undefined && empty(c)))
  if (fill.receipt_no && line.receipt_qr) delete fill.receipt_no
  if (fill.receipt_qr && line.receipt_no) delete fill.receipt_qr
  const have = await itemsOf(env, id)
  const by = `Photo reading (${got.model})`
  const cols = Object.keys(fill)
  const stmts = [
    env.DB.prepare(`UPDATE cash_lines SET ${cols.map((c) => `${c} = ?, `).join('')}ai_reading = ?, ai_read_at = ? WHERE id = ?`)
      .bind(...cols.map((c) => fill[c]), JSON.stringify({ reading: got.reading, model: got.model, usage: got.usage, costUsd: got.costUsd, at: now }), now, id),
    ...changeStmts(env, line, fill, 'app', by),
  ]
  if (!have.length) items.forEach((x, n) => {
    stmts.push(env.DB.prepare('INSERT INTO cash_line_items (line_id, item, amount_cents, sort, created_by) VALUES (?, ?, ?, ?, ?)').bind(id, x.item, x.amount_cents, n + 1, by))
    stmts.push(histStmt(env, id, 'item', null, itemText(x), 'app', by))
  })
  if (got.reading.is_receipt === false) stmts.push(histStmt(env, id, 'read', null, 'Not a receipt', 'app', by))
  await env.DB.batch(stmts)
  await audit(env, staff.email, 'read_photo', 'cash_line', id, { model: got.model, costUsd: got.costUsd })
  return json({ row: TABLES.lines.shape({ ...(await lineById(env, id)), items: await itemsOf(env, id) }, manager) })
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
    const sorts = days.length ? (await env.DB.prepare(`SELECT day, MAX(sort) AS s FROM cash_lines WHERE branch_id = 1 AND day IN (${days.map(() => '?').join(', ')}) GROUP BY day`).bind(...days).all()).results : []
    for (const x of sorts) nextSort[x.day] = x.s || 0
    for (const kind of ['lines', 'expenses', 'remits']) {
      for (const p of plan[kind]) {
        if (p.status !== 'add') continue
        const f = { ...p.fields, day: p.day }
        if (kind === 'lines') Object.assign(f, { sort: nextSort[p.day] = (nextSort[p.day] || 0) + 1, stage: 'owner', owner_approved_at: new Date().toISOString(), owner_approved_by: who })
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
async function itemRoute(env, staff, method, id, b, manager) {
  const now = new Date().toISOString()
  const source = manager ? 'owner' : 'staff'
  const old = id ? await env.DB.prepare('SELECT * FROM cash_line_items WHERE id = ? AND deleted_at IS NULL').bind(id).first() : null
  if (id && !old) return fail(404, 'This item was not found. Reload the page.')
  const line = await lineById(env, old ? old.line_id : b.lineId)
  if (!line) return fail(404, 'This receipt was not found. Reload the page.')
  if (!manager && line.stage === 'owner') return fail(403, LOCKED)
  if (method === 'DELETE' && id) {
    await env.DB.batch([env.DB.prepare('UPDATE cash_line_items SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(now, staff.name, id),
      histStmt(env, line.id, 'item', itemText(old), null, source, staff.name)])
    await audit(env, staff.email, 'delete', 'cash_line_item', id)
    return json({ ok: true })
  }
  const amount = money(b.amountCents)
  if (Number.isNaN(amount)) return fail(400, 'Enter the amount as a number, e.g. 300.', { errors: { amountCents: 'Enter the amount as a number, e.g. 300.' } })
  const item = clean(b.item, 120) || null
  if (method === 'POST') {
    const row = await env.DB.prepare(`INSERT INTO cash_line_items (line_id, item, amount_cents, sort, created_by)
      VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM cash_line_items WHERE line_id = ?), ?) RETURNING *`).bind(line.id, item, amount, line.id, staff.name).first()
    if (item || amount != null) await histStmt(env, line.id, 'item', null, itemText(row), source, staff.name).run()
    await audit(env, staff.email, 'create', 'cash_line_item', row.id, { line: line.id })
    return json({ row: itemShape(row) }, 201)
  }
  if (method === 'PATCH' && id) {
    const [res, ...rest] = await env.DB.batch([
      env.DB.prepare('UPDATE cash_line_items SET item = ?, amount_cents = ?, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *').bind(item, amount, now, staff.name, id),
      ...(itemText(old) !== itemText({ item, amount_cents: amount }) ? [histStmt(env, line.id, 'item', itemText(old), itemText({ item, amount_cents: amount }), source, staff.name)] : []),
    ])
    void rest
    await audit(env, staff.email, 'update', 'cash_line_item', id)
    return json({ row: itemShape(res.results[0]) })
  }
  return fail(405, 'Not allowed.')
}

// ---------- A receipt's photo ----------
async function photoRoute(env, staff, request, method, lineId, manager) {
  if (!lineId) return fail(404, 'Not found.')
  if (!env.PHOTOS) return fail(503, "Photo storage isn't connected yet.")
  const line = await env.DB.prepare('SELECT id, day, stage, photo_key, photo_type FROM cash_lines WHERE id = ? AND branch_id = 1 AND deleted_at IS NULL').bind(lineId).first()
  if (!line) return fail(404, 'This receipt was not found. Reload the page.')
  if (method === 'GET') {
    if (!line.photo_key) return fail(404, 'This receipt has no photo.')
    const obj = await env.PHOTOS.get(line.photo_key)
    if (!obj) return fail(404, "This photo hasn't been uploaded yet.")
    return new Response(obj.body, { headers: { 'Content-Type': line.photo_type || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Length': String(obj.size) } })
  }
  if (method !== 'POST') return fail(405, 'Not allowed.')
  if (!manager && line.stage === 'owner') return fail(403, LOCKED)
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return fail(400, 'Upload a photo (JPG, PNG or WebP).')
  const body = await request.arrayBuffer()
  if (!body.byteLength) return fail(400, 'The photo was empty. Try again.')
  if (body.byteLength > PHOTO_MAX) return fail(400, 'This photo is too big (over 8 MB). Try again: the app makes photos smaller first.')
  const key = `receipts/${line.day}/${line.id}-${Date.now()}.${type.split('/')[1].replace('jpeg', 'jpg')}`
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType: type } })
  await env.DB.batch([env.DB.prepare('UPDATE cash_lines SET photo_key = ?, photo_type = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(key, type, new Date().toISOString(), staff.name, line.id),
    histStmt(env, line.id, 'photo', null, line.photo_key ? 'Photo replaced' : 'Photo added', manager ? 'owner' : 'staff', staff.name)])
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

// ---------- Clear This Day / Restore Day (owners and admins) ----------
// Cleared rows get deleted_by "<name> (cleared <time>)": that tag is how Restore Day finds exactly those rows.
const CLEAR_TABLES = ['cash_lines', 'cash_expenses', 'cash_remits']
async function lastClear(env, day) {
  const r = await env.DB.prepare(`SELECT deleted_by AS tag, MAX(deleted_at) AS at, COUNT(*) AS n FROM cash_lines WHERE branch_id = 1 AND day = ? AND book = 'owner' AND deleted_by LIKE '% (cleared %)'
    GROUP BY deleted_by ORDER BY at DESC LIMIT 1`).bind(day).first()
  const e = await env.DB.prepare(`SELECT deleted_by AS tag, MAX(deleted_at) AS at, COUNT(*) AS n FROM cash_expenses WHERE branch_id = 1 AND day = ? AND book = 'owner' AND deleted_by LIKE '% (cleared %)'
    GROUP BY deleted_by ORDER BY at DESC LIMIT 1`).bind(day).first()
  const best = [r, e].filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
  if (!best) return null
  return { tag: best.tag, at: best.at, by: best.tag.replace(/ \(cleared .*\)$/, ''), receipts: r && r.tag === best.tag ? r.n : 0, expenses: e && e.tag === best.tag ? e.n : 0 }
}
async function clearDay(env, staff, b) {
  if (!isDay(b.day)) return fail(400, 'Choose the day.')
  if (String(b.confirm || '').trim().toLowerCase() !== short(b.day).toLowerCase()) return fail(400, `Type ${short(b.day)} to confirm.`, { errors: { confirm: `Type ${short(b.day)} to confirm.` } })
  const now = new Date().toISOString()
  const tag = `${clean(staff.name, 60)} (cleared ${now})`
  const res = await env.DB.batch(CLEAR_TABLES.map((t) => env.DB.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ? WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL`).bind(now, tag, b.day)))
  const counts = Object.fromEntries(CLEAR_TABLES.map((t, i) => [t, res[i].meta?.changes || 0]))
  if (!Object.values(counts).some(Boolean)) return fail(400, `There’s nothing to clear on ${short(b.day)}.`)
  await audit(env, staff.email, 'clear_day', 'cash_day', null, { day: b.day, ...counts })
  return json({ ok: true, tag, counts })
}
async function restoreDay(env, staff, b) {
  if (!isDay(b.day) || !String(b.tag || '').includes(' (cleared ')) return fail(400, 'Reload the page and try again.')
  if (b.preview) return json(await restorePreview(env, b.day, b.tag))
  const res = await env.DB.batch(CLEAR_TABLES.map((t) => env.DB.prepare(`UPDATE ${t} SET deleted_at = NULL, deleted_by = NULL WHERE branch_id = 1 AND day = ? AND deleted_by = ?`).bind(b.day, b.tag)))
  const restored = res.reduce((n, r) => n + (r.meta?.changes || 0), 0)
  if (!restored) return fail(400, 'Nothing to restore: it may have been restored already.')
  await audit(env, staff.email, 'restore_day', 'cash_day', null, { day: b.day, restored })
  return json({ ok: true, restored })
}

// What Restore Day would bring back (shown before restoring), and receipt numbers typed again since the clear.
async function restorePreview(env, day, tag) {
  const [l, e, x, active] = await env.DB.batch([
    env.DB.prepare(`SELECT l.id, l.receipt_no, l.receipt_qr, l.client_name, l.amount_cents, (SELECT COUNT(*) FROM cash_line_items i WHERE i.line_id = l.id AND i.deleted_at IS NULL) AS items
      FROM cash_lines l WHERE l.branch_id = 1 AND l.day = ? AND l.deleted_by = ? ORDER BY l.sort, l.id`).bind(day, tag),
    env.DB.prepare('SELECT category, description, amount_cents FROM cash_expenses WHERE branch_id = 1 AND day = ? AND deleted_by = ? ORDER BY id').bind(day, tag),
    env.DB.prepare('SELECT kind, amount_cents FROM cash_remits WHERE branch_id = 1 AND day = ? AND deleted_by = ? ORDER BY kind').bind(day, tag),
    env.DB.prepare('SELECT receipt_no, receipt_qr FROM cash_lines WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL').bind(day),
  ])
  const nums = new Set(active.results.flatMap((r) => [r.receipt_no, r.receipt_qr]).filter(Boolean))
  return {
    receipts: l.results.map((r) => ({ receiptNo: r.receipt_no || '', receiptQr: r.receipt_qr || '', client: r.client_name || '', amountCents: r.amount_cents, items: r.items,
      again: !!((r.receipt_no && nums.has(r.receipt_no)) || (r.receipt_qr && nums.has(r.receipt_qr))) })),
    expenses: e.results.map((r) => ({ category: r.category, description: r.description || '', amountCents: r.amount_cents })),
    remits: x.results.map((r) => ({ kind: r.kind, amountCents: r.amount_cents })),
    summary: null,
  }
}
