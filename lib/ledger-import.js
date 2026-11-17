// Finances ▸ Ledger ▸ Import File: turns the ledger template's sheets (Receipts, Items, Expenses, Remits) into rows
// for the Ledger. Used in the browser (after src/lib/xlsx.js reads the file); the server checks everything again.
// Headers are matched loosely ("Owner's Name", "Owner", "Client" all work), so a file typed by hand or made by
// Claude from the receipt photos both import. Money is in pesos (1500 or "₱1,500.00"); dates as Excel dates,
// 2026-11-16, 11/16/2026 or Nov 16, 2026.

import { EXPENSE_TYPES } from './daily-cash.js'

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const SHEETS = {
  lines: {
    match: /receipt|sale|income/,
    not: /item/,
    columns: {
      day: ['date', 'day'],
      receiptNo: ['receiptnoor', 'receiptor', 'or', 'orno', 'ornumber', 'invoice', 'invoiceno'],
      receiptQr: ['receiptnoqr', 'receiptqr', 'qr', 'qrno', 'qrnumber', 'quotation', 'quotationslip', 'slipno'],
      clientName: ['ownersname', 'ownername', 'owner', 'client', 'clientname', 'name'],
      petNames: ['petsname', 'petname', 'pet', 'pets', 'petsnames'],
      amountCents: ['totalperreceipt', 'total', 'receipttotal', 'amount'],
      discountCents: ['discounts', 'discount', 'less', 'lessdiscount'],
      note: ['notes', 'note', 'discountsandnotes', 'remarks'],
      onlineCents: ['onlinepayments', 'online', 'onlinepayment'],
      depositCents: ['deposit', 'deposits'],
      balanceCents: ['balance', 'balances'],
      incomeCents: ['totalincome', 'income'],
      commissionCents: ['commissions', 'commission'],
    },
  },
  items: {
    match: /item/,
    columns: {
      day: ['date', 'day'],
      receipt: ['receiptno', 'receipt', 'receiptnumber', 'no', 'receiptnoor', 'receiptnoqr', 'or', 'qr'],
      item: ['item', 'items', 'description', 'particulars', 'itemdescription', 'service'],
      qty: ['qty', 'quantity'],
      unitCents: ['unitprice', 'price', 'unitcost', 'each'],
      amountCents: ['amount', 'total', 'itemamount'],
    },
  },
  expenses: {
    match: /expense/,
    columns: {
      day: ['date', 'day'],
      category: ['type', 'category', 'expensetype'],
      description: ['whatfor', 'description', 'details', 'item', 'particulars'],
      amountCents: ['amount', 'total', 'cost'],
    },
  },
  remits: {
    match: /remit/,
    columns: {
      day: ['date', 'day'],
      kind: ['remit', 'kind', 'which', 'remittype'],
      amountCents: ['amount', 'total'],
      remittedBy: ['remittedby', 'by', 'name'],
    },
  },
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n) => String(n).padStart(2, '0')
const okDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === +y && t.getUTCMonth() === m - 1 && t.getUTCDate() === +d ? `${y}-${pad(m)}-${pad(d)}` : null }
export function toDay(v) {
  if (v === '' || v == null) return null
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400e3).toISOString().slice(0, 10) : null
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return okDay(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/) // month/day/year, as the clinic writes it
  if (m) return okDay(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (m && MONTHS.includes(m[1].toLowerCase())) return okDay(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])
  return null
}
export function toCents(v) {
  if (v === '' || v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : NaN
  const t = String(v).replace(/[₱,\s]|php|p(?=\d)/gi, '')
  if (t === '' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN
}
const text = (v) => (v === '' || v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim())
// Receipt numbers keep their leading zeros: a number cell 5329 becomes "05329".
const receiptNo = (v) => (typeof v === 'number' && Number.isInteger(v) ? String(v).padStart(5, '0') : text(v))
const remitKind = (v) => { const t = norm(v); return /^(1|1st|first|3pm)/.test(t) ? 'first' : /^(2|2nd|second|end)/.test(t) ? 'second' : null }
const expenseType = (v) => EXPENSE_TYPES.find((t) => norm(t) === norm(v)) || EXPENSE_TYPES.find((t) => norm(v) && norm(t).startsWith(norm(v)))

// sheets: { name: [[cells]] }. fallbackDay: used when the file has no Date column (one day picked on the Ledger).
export function readLedgerSheets(sheets, fallbackDay = null) {
  const out = { lines: [], items: [], expenses: [], remits: [], problems: [] }
  const names = Object.keys(sheets)
  for (const [kind, spec] of Object.entries(SHEETS)) {
    const name = names.find((n) => spec.match.test(n.toLowerCase()) && !(spec.not && spec.not.test(n.toLowerCase()))) || (kind === 'lines' && names.length === 1 ? names[0] : null)
    if (!name) continue
    const rows = sheets[name]
    // The header row: the first row (of the first 10) where at least two headers are recognised.
    let headerAt = -1
    let map = null
    for (let i = 0; i < Math.min(rows.length, 10) && headerAt < 0; i++) {
      const m = {}
      ;(rows[i] || []).forEach((cell, c) => {
        const key = Object.keys(spec.columns).find((k) => spec.columns[k].includes(norm(cell)))
        if (key && m[key] === undefined) m[key] = c
      })
      if (Object.keys(m).length >= 2) { headerAt = i; map = m }
    }
    if (headerAt < 0) { out.problems.push(`The ${name} sheet has no header row the Ledger recognises. Use the template’s headers.`); continue }
    for (let i = headerAt + 1; i < rows.length; i++) {
      const cells = rows[i] || []
      const get = (k) => (map[k] === undefined ? '' : cells[map[k]])
      if (!cells.some((x) => text(x) !== '')) continue
      const first = norm(cells.find((x) => text(x) !== ''))
      if (/^(total|totals|grandtotal|subtotal)$/.test(first)) continue
      const line = i + 1
      const issues = []
      const rawDay = get('day')
      const day = map.day === undefined || text(rawDay) === '' ? (kind === 'items' ? null : fallbackDay) : toDay(rawDay)
      if (!day && kind !== 'items') issues.push(map.day === undefined || text(rawDay) === '' ? 'No date' : `Date “${text(rawDay)}” not understood`)
      const row = { sheet: name, line, day, issues }
      for (const k of Object.keys(spec.columns)) {
        if (k === 'day') continue
        const v = get(k)
        if (k.endsWith('Cents')) {
          // An item can be a discount written as a minus amount (-20): it goes to the receipt's Discounts.
          const minus = kind === 'items' && (typeof v === 'number' ? v < 0 : /^\s*[-−(]/.test(text(v)))
          const c = minus ? -toCents(typeof v === 'number' ? -v : text(v).replace(/^\s*[-−(]|\)\s*$/g, '')) : toCents(v)
          if (Number.isNaN(c)) issues.push(`“${text(v)}” isn’t an amount`)
          row[k] = Number.isNaN(c) ? null : c
        } else if (k === 'receiptNo' || k === 'receiptQr' || k === 'receipt') row[k] = receiptNo(v)
        else if (k === 'qty') row.qty = typeof v === 'number' ? v : Number(text(v)) || null
        else if (k === 'kind') { row.kind = remitKind(v); if (!row.kind) issues.push(`Remit “${text(v)}” should be 1st or 2nd`) }
        else if (k === 'category') { row.category = expenseType(v) || 'Other'; if (text(v) && !expenseType(v)) row.note = `Type “${text(v)}” saved as Other` }
        else row[k] = text(v)
      }
      out[kind].push(row)
    }
  }
  // Items go under their receipt (matched by its OR or QR number, and the date when both have one).
  for (const it of out.items) {
    const amount = it.amountCents ?? (it.qty && it.unitCents != null ? Math.round(it.qty * it.unitCents) : null)
    const label = it.item && it.qty > 1 && it.unitCents != null ? `${it.item} ${it.qty} × ${it.unitCents / 100}` : it.item
    if (!it.receipt && !label) continue
    const line = out.lines.find((l) => it.receipt && (l.receiptNo === it.receipt || l.receiptQr === it.receipt) && (!it.day || !l.day || it.day === l.day))
    if (!line) { out.problems.push(`${it.sheet} row ${it.line}: receipt ${it.receipt || '(no number)'} isn’t on the Receipts sheet, so “${label || ''}” was left out.`); continue }
    if ((amount != null && amount < 0) || /^(less|discount)/i.test(it.item || '')) {
      if (amount) line.discountCents = (line.discountCents || 0) + Math.abs(amount)
      continue
    }
    if (it.issues.length) line.issues.push(`Item “${label || ''}”: ${it.issues.join(', ')}`)
    ;(line.items ||= []).push({ item: label || '', amountCents: amount })
  }
  delete out.items
  if (!out.lines.length && !out.expenses.length && !out.remits.length && !out.problems.length) out.problems.push('No Receipts, Expenses or Remits sheet with rows was found. Use the Ledger template.')
  return out
}
