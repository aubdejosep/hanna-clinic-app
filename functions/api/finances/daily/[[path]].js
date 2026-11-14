// Finances ▸ Daily Cash (owners and admins). Rules and math: lib/daily-cash.js.
//   GET    /api/finances/daily?day=YYYY-MM-DD   -> that day's lines (saved ones, plus payments taken in the app
//                                                 that haven't been edited yet), expenses, remits, rates, vets
//   GET    /api/finances/daily/days?month=YYYY-MM -> each day's totals, for the list of days
//   POST   /api/finances/daily/lines            {day, paymentId?, receiptNo, clientName, petNames, vetStaffId, method,
//                                                 amountCents, medsCents, doctorCents, surgeryCents, labTests, commissionCents|null, note}
//   PATCH  /api/finances/daily/lines/:id        (the same fields)    DELETE -> soft-deleted
//   POST   /api/finances/daily/expenses         {day, category, description, amountCents}   PATCH/DELETE /expenses/:id
//   POST   /api/finances/daily/remits           {day, kind: first|second, amountCents, remittedBy, note}   PATCH/DELETE /remits/:id
//   PUT    /api/finances/daily/rates            {medsPct, doctorPct, surgeryPct, labCents}

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'
import { DEFAULT_RATES, EXPENSE_TYPES, METHODS, breakdown, cleanRates, summarize } from '../../../../lib/daily-cash.js'

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
const cents = (v, max = 100000000) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : null }
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

async function getRates(env) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'commission_rates'").first().catch(() => null)
  try { return cleanRates(row?.value ? JSON.parse(row.value) : DEFAULT_RATES) } catch { return DEFAULT_RATES }
}
const shapeLine = (l) => ({
  id: l.id, paymentId: l.payment_id, receiptNo: l.receipt_no || '', clientName: l.client_name || '', petNames: l.pet_names || '',
  vetStaffId: l.vet_staff_id, vetName: l.vet_name || '', method: l.method, amountCents: l.amount_cents, medsCents: l.meds_cents,
  doctorCents: l.doctor_cents, surgeryCents: l.surgery_cents, labTests: l.lab_tests, commissionCents: l.commission_cents, note: l.note || '',
  voided: !!l.payment_voided, fromApp: !!l.payment_id, updatedBy: l.updated_by || l.created_by,
})

// Payments taken in the app on this day that have no line yet, shaped as lines (with the commission breakdown
// worked out from what was on the visit or sale).
async function appLines(env, day) {
  const { results: pays } = await env.DB.prepare(`SELECT p.*, COALESCE(o.full_name, o2.full_name, s.customer) AS client, pt.name AS pet,
      (SELECT st.id FROM appointment_staff x JOIN staff st ON st.id = x.staff_id WHERE x.appointment_id = p.appointment_id ORDER BY st.role = 'vet' DESC, st.id LIMIT 1) AS vet_id,
      (SELECT st.first_name || ' ' || st.last_name FROM appointment_staff x JOIN staff st ON st.id = x.staff_id WHERE x.appointment_id = p.appointment_id ORDER BY st.role = 'vet' DESC, st.id LIMIT 1) AS vet_name
    FROM payments p LEFT JOIN appointments a ON a.id = p.appointment_id LEFT JOIN owners o ON o.id = a.owner_id LEFT JOIN pets pt ON pt.id = a.pet_id
      LEFT JOIN sales s ON s.id = p.sale_id LEFT JOIN owners o2 ON o2.id = COALESCE(p.owner_id, s.owner_id)
    WHERE p.branch_id = 1 AND p.day = ? AND p.voided_at IS NULL AND p.method <> 'no_charge' AND p.amount_cents > 0
      AND NOT EXISTS (SELECT 1 FROM cash_lines c WHERE c.payment_id = p.id AND c.deleted_at IS NULL)
    ORDER BY p.at`).bind(day).all()
  if (!pays.length) return []
  const apptIds = pays.filter((p) => p.appointment_id && p.kind !== 'balance').map((p) => p.appointment_id)
  const saleIds = pays.filter((p) => p.sale_id).map((p) => p.sale_id)
  const q = (list) => list.map(() => '?').join(',') || 'NULL'
  const [ai, si] = await env.DB.batch([
    env.DB.prepare(`SELECT i.appointment_id, i.kind, i.name, i.qty, i.price_cents, c.name AS category, pr.category AS product_category
      FROM appointment_items i LEFT JOIN services sv ON sv.id = i.service_id LEFT JOIN service_categories c ON c.id = sv.category_id LEFT JOIN products pr ON pr.id = i.product_id
      WHERE i.deleted_at IS NULL AND i.appointment_id IN (${q(apptIds)})`).bind(...apptIds),
    env.DB.prepare(`SELECT si.sale_id, si.name, si.qty, si.price_cents, pr.category FROM sale_items si LEFT JOIN products pr ON pr.id = si.product_id WHERE si.sale_id IN (${q(saleIds)})`).bind(...saleIds),
  ])
  return pays.map((p) => {
    const items = p.sale_id
      ? si.results.filter((i) => i.sale_id === p.sale_id).map((i) => ({ kind: 'product', name: i.name, qty: i.qty, priceCents: i.price_cents, category: i.category }))
      : p.kind === 'balance' ? [] : ai.results.filter((i) => i.appointment_id === p.appointment_id).map((i) => ({ kind: i.kind, name: i.name, qty: i.qty, priceCents: i.price_cents, category: i.kind === 'product' ? i.product_category : i.category }))
    return {
      id: null, paymentId: p.id, receiptNo: '', clientName: p.client || '', petNames: p.pet || '', vetStaffId: p.vet_id || null, vetName: (p.vet_name || '').trim(),
      method: METHODS.some((m) => m.key === p.method) ? p.method : 'other', amountCents: p.amount_cents, ...breakdown(items), commissionCents: null,
      note: p.kind === 'balance' ? 'Balance payment' : p.note || '', voided: false, fromApp: true, unsaved: true, at: p.at,
    }
  })
}

async function dayData(env, day) {
  const [lines, exps, rems, vets] = await env.DB.batch([
    env.DB.prepare(`SELECT c.*, p.voided_at AS payment_voided FROM cash_lines c LEFT JOIN payments p ON p.id = c.payment_id
      WHERE c.branch_id = 1 AND c.day = ? AND c.deleted_at IS NULL ORDER BY c.sort, c.id`).bind(day),
    env.DB.prepare('SELECT * FROM cash_expenses WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL ORDER BY id').bind(day),
    env.DB.prepare('SELECT * FROM cash_remits WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL ORDER BY kind, id').bind(day),
    env.DB.prepare("SELECT id, first_name || ' ' || last_name AS name, role FROM staff WHERE active = 1 ORDER BY role = 'vet' DESC, first_name"),
  ])
  return {
    day, rates: await getRates(env),
    lines: [...lines.results.map(shapeLine), ...(await appLines(env, day))],
    expenses: exps.results.map((e) => ({ id: e.id, category: e.category, description: e.description || '', amountCents: e.amount_cents, by: e.updated_by || e.created_by })),
    remits: rems.results.map((r) => ({ id: r.id, kind: r.kind, amountCents: r.amount_cents, remittedBy: r.remitted_by || '', note: r.note || '', by: r.updated_by || r.created_by })),
    vets: vets.results.map((v) => ({ id: v.id, name: v.name.trim(), role: v.role })),
    expenseTypes: EXPENSE_TYPES,
  }
}

function lineFields(b, errors) {
  const f = {
    receipt_no: clean(b.receiptNo, 40) || null, client_name: clean(b.clientName, 120) || null, pet_names: clean(b.petNames, 200) || null,
    vet_staff_id: b.vetStaffId ? Number(b.vetStaffId) : null, method: METHODS.some((m) => m.key === b.method) ? b.method : null,
    amount_cents: cents(b.amountCents), meds_cents: cents(b.medsCents ?? 0), doctor_cents: cents(b.doctorCents ?? 0), surgery_cents: cents(b.surgeryCents ?? 0),
    lab_tests: Number.isInteger(Number(b.labTests ?? 0)) && Number(b.labTests ?? 0) >= 0 && Number(b.labTests ?? 0) <= 200 ? Number(b.labTests ?? 0) : null,
    commission_cents: b.commissionCents === null || b.commissionCents === '' || b.commissionCents === undefined ? null : cents(b.commissionCents), note: clean(b.note, 300) || null,
  }
  if (!f.method) errors.method = 'Choose how they paid.'
  if (f.amount_cents === null) errors.amountCents = 'Enter the amount, e.g. 1500.'
  for (const [k, field] of [['meds_cents', 'medsCents'], ['doctor_cents', 'doctorCents'], ['surgery_cents', 'surgeryCents']]) if (f[k] === null) errors[field] = 'Enter an amount, or 0.'
  if (f.lab_tests === null) errors.labTests = 'Enter how many lab tests, or 0.'
  if (b.commissionCents != null && b.commissionCents !== '' && f.commission_cents === null) errors.commissionCents = 'Enter the commission, or leave it blank to use the formula.'
  return f
}

export async function onRequest({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can open Daily Cash.')
  const path = [].concat(params.path || [])
  const [what, rawId] = path
  const id = rawId ? Number(rawId) : null
  const method = request.method
  const url = new URL(request.url)
  const who = data.staff.name
  const now = new Date().toISOString()

  if (method === 'GET' && !what) {
    const day = url.searchParams.get('day') || manilaToday()
    if (!isDay(day)) return fail(400, 'Choose a day.')
    return json(await dayData(env, day))
  }

  if (method === 'GET' && what === 'days') { // each day's totals in a month
    const month = url.searchParams.get('month') || manilaToday().slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) return fail(400, 'Choose a month.')
    const like = `${month}-%`
    const [ls, ps, es, rs] = await env.DB.batch([
      env.DB.prepare('SELECT day, method, amount_cents FROM cash_lines c WHERE branch_id = 1 AND day LIKE ? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = c.payment_id AND p.voided_at IS NOT NULL)').bind(like),
      env.DB.prepare(`SELECT day, method, amount_cents FROM payments p WHERE branch_id = 1 AND day LIKE ? AND voided_at IS NULL AND method <> 'no_charge' AND amount_cents > 0
        AND NOT EXISTS (SELECT 1 FROM cash_lines c WHERE c.payment_id = p.id AND c.deleted_at IS NULL)`).bind(like),
      env.DB.prepare('SELECT day, amount_cents FROM cash_expenses WHERE branch_id = 1 AND day LIKE ? AND deleted_at IS NULL').bind(like),
      env.DB.prepare('SELECT day, kind, amount_cents FROM cash_remits WHERE branch_id = 1 AND day LIKE ? AND deleted_at IS NULL').bind(like),
    ])
    const days = {}
    const at = (d) => (days[d] ||= { lines: [], expenses: [], remits: [] })
    for (const r of [...ls.results, ...ps.results]) at(r.day).lines.push({ method: METHODS.some((m) => m.key === r.method) ? r.method : 'other', amountCents: r.amount_cents })
    for (const r of es.results) at(r.day).expenses.push({ amountCents: r.amount_cents })
    for (const r of rs.results) at(r.day).remits.push({ kind: r.kind, amountCents: r.amount_cents })
    return json({ month, days: Object.keys(days).sort().reverse().map((d) => { const s = summarize(days[d]); return { day: d, total: s.total, onlines: s.onlines, cashOnHand: s.cashOnHand, hasSecond: s.hasSecond, difference: s.difference, receipts: s.receipts } }) })
  }

  if (what === 'rates' && method === 'PUT') {
    const rates = cleanRates((await readJson(request)) || {})
    await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('commission_rates', ?1, ?2, ?3)
      ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2, updated_by = ?3`).bind(JSON.stringify(rates), now, data.staff.email).run()
    await audit(env, data.staff.email, 'update', 'commission_rates', null, rates)
    return json({ rates })
  }

  const b = method === 'POST' || method === 'PATCH' ? (await readJson(request)) || {} : {}

  if (what === 'lines') {
    if (method === 'DELETE' && id) {
      await env.DB.prepare('UPDATE cash_lines SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(now, who, id).run()
      await audit(env, data.staff.email, 'delete', 'cash_line', id)
      return json({ ok: true })
    }
    const errors = {}
    const f = lineFields(b, errors)
    if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
    if (f.vet_staff_id) {
      const v = await env.DB.prepare("SELECT first_name || ' ' || last_name AS name FROM staff WHERE id = ?").bind(f.vet_staff_id).first()
      if (!v) return fail(400, 'Choose a vet from the staff list.', { errors: { vetStaffId: 'Choose a vet from the list.' } })
      f.vet_name = v.name.trim()
    } else f.vet_name = null
    const cols = Object.keys(f)
    if (method === 'POST') {
      const day = String(b.day || '')
      if (!isDay(day)) return fail(400, 'Choose a day.')
      const paymentId = b.paymentId ? Number(b.paymentId) : null
      if (paymentId && await env.DB.prepare('SELECT 1 FROM cash_lines WHERE payment_id = ? AND deleted_at IS NULL').bind(paymentId).first()) return fail(409, 'This payment already has a line. Reload the page.')
      const row = await env.DB.prepare(`INSERT INTO cash_lines (day, payment_id, ${cols.join(', ')}, sort, created_by) VALUES (?, ?, ${cols.map(() => '?').join(', ')},
        (SELECT COALESCE(MAX(sort), 0) + 1 FROM cash_lines WHERE day = ?), ?) RETURNING id`).bind(day, paymentId, ...cols.map((c) => f[c]), day, who).first()
      await audit(env, data.staff.email, 'create', 'cash_line', row.id, { day, paymentId })
      return json({ id: row.id }, 201)
    }
    if (method === 'PATCH' && id) {
      const res = await env.DB.prepare(`UPDATE cash_lines SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL`).bind(...cols.map((c) => f[c]), now, who, id).run()
      if (!res.meta.changes) return fail(404, 'This line was not found. Reload the page.')
      await audit(env, data.staff.email, 'update', 'cash_line', id)
      return json({ ok: true })
    }
  }

  if (what === 'expenses') {
    if (method === 'DELETE' && id) {
      await env.DB.prepare('UPDATE cash_expenses SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(now, who, id).run()
      await audit(env, data.staff.email, 'delete', 'cash_expense', id)
      return json({ ok: true })
    }
    const category = EXPENSE_TYPES.includes(b.category) ? b.category : null
    const amount = cents(b.amountCents)
    const errors = { ...(category ? {} : { category: 'Choose a type.' }), ...(amount ? {} : { amountCents: 'Enter the amount, e.g. 160.' }) }
    if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
    const description = clean(b.description, 200) || null
    if (method === 'POST') {
      if (!isDay(b.day)) return fail(400, 'Choose a day.')
      const row = await env.DB.prepare('INSERT INTO cash_expenses (day, category, description, amount_cents, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(b.day, category, description, amount, who).first()
      await audit(env, data.staff.email, 'create', 'cash_expense', row.id, { category, amount })
      return json({ id: row.id }, 201)
    }
    if (method === 'PATCH' && id) {
      await env.DB.prepare('UPDATE cash_expenses SET category = ?, description = ?, amount_cents = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL').bind(category, description, amount, now, who, id).run()
      await audit(env, data.staff.email, 'update', 'cash_expense', id)
      return json({ ok: true })
    }
  }

  if (what === 'remits') {
    if (method === 'DELETE' && id) {
      await env.DB.prepare('UPDATE cash_remits SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(now, who, id).run()
      await audit(env, data.staff.email, 'delete', 'cash_remit', id)
      return json({ ok: true })
    }
    const kind = ['first', 'second'].includes(b.kind) ? b.kind : null
    const amount = cents(b.amountCents)
    const errors = { ...(kind ? {} : { kind: 'Choose 1st or 2nd Remit.' }), ...(amount !== null ? {} : { amountCents: 'Enter the amount, e.g. 9820.' }) }
    if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
    const by = clean(b.remittedBy, 80) || null
    const note = clean(b.note, 200) || null
    if (method === 'POST') {
      if (!isDay(b.day)) return fail(400, 'Choose a day.')
      const row = await env.DB.prepare('INSERT INTO cash_remits (day, kind, amount_cents, remitted_by, note, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id').bind(b.day, kind, amount, by, note, who).first()
      await audit(env, data.staff.email, 'create', 'cash_remit', row.id, { kind, amount })
      return json({ id: row.id }, 201)
    }
    if (method === 'PATCH' && id) {
      await env.DB.prepare('UPDATE cash_remits SET kind = ?, amount_cents = ?, remitted_by = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL').bind(kind, amount, by, note, now, who, id).run()
      await audit(env, data.staff.email, 'update', 'cash_remit', id)
      return json({ ok: true })
    }
  }

  return fail(404, 'Not found.')
}
