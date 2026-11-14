// Finances ▸ Ledger (owners and admins): the cash ledger, typed in like a spreadsheet. Math: lib/daily-cash.js.
//   GET    /api/finances/daily?from=YYYY-MM-DD&to=YYYY-MM-DD -> receipts, expenses and remits in that range
//   POST   /api/finances/daily/lines     {day, receiptNo, clientName, petNames, note, amountCents, method, commissionCents}
//   PATCH  /api/finances/daily/lines/:id (the same)            DELETE -> soft-deleted
//   POST   /api/finances/daily/expenses  {day, category, description, amountCents}   PATCH / DELETE /expenses/:id
//   POST   /api/finances/daily/remits    {day, kind: first|second, amountCents, remittedBy}   PATCH / DELETE /remits/:id
// Rows can be saved half-filled (a spreadsheet is typed cell by cell); blanks count as 0.

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'
import { EXPENSE_TYPES, METHODS } from '../../../../lib/daily-cash.js'

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
const money = (v) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 1e10 ? n : NaN }
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

const TABLES = {
  lines: {
    table: 'cash_lines', entity: 'cash_line',
    fields(b, errors) {
      const amount = money(b.amountCents)
      const commission = money(b.commissionCents)
      if (Number.isNaN(amount)) errors.amountCents = 'Enter the amount as a number, e.g. 1500.'
      if (Number.isNaN(commission)) errors.commissionCents = 'Enter the commission as a number, e.g. 150.'
      const method = METHODS.some((m) => m.key === b.method) ? b.method : 'cash'
      return { receipt_no: clean(b.receiptNo, 40) || null, client_name: clean(b.clientName, 120) || null, pet_names: clean(b.petNames, 200) || null,
        note: clean(b.note, 300) || null, amount_cents: amount ?? 0, method, commission_cents: commission }
    },
    shape: (r) => ({ id: r.id, day: r.day, receiptNo: r.receipt_no || '', clientName: r.client_name || '', petNames: r.pet_names || '', note: r.note || '',
      amountCents: r.amount_cents, method: r.method, commissionCents: r.commission_cents }),
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
  const [what, rawId] = [].concat(params.path || [])
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
