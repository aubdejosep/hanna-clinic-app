// Finances ▸ Ledger: the clinic's cash ledger, typed in like a spreadsheet (one row per receipt), with the
// totals worked out the same way on the screen and the server. No imports.
//
//   Total Income - Onlines - Expenses - 1st Remit = Cash On Hand (what the 2nd Remit should be)
//   Commission is typed per receipt and added up; it isn't taken out of the cash.

export const METHODS = [
  { key: 'cash', label: 'Cash', online: false },
  { key: 'gcash', label: 'GCash', online: true },
  { key: 'maribank', label: 'MariBank', online: true },
  { key: 'bank', label: 'Bank Transfer', online: true },
  { key: 'qrph', label: 'QRPH', online: true },
  { key: 'card', label: 'Credit Card', online: true },
]
// Older rows may hold these; they still count as online.
const EXTRA = { maya: 'Maya', other: 'Other' }
export const methodLabel = (k) => METHODS.find((m) => m.key === k)?.label || EXTRA[k] || 'Cash'
export const isOnline = (k) => k !== 'cash'
export const EXPENSE_TYPES = ['Supplies', 'Medicines & Stock', 'Food', 'Transport', 'Utilities', 'Repairs & Maintenance', 'Vet Commission', 'Other']

export function summarize({ lines = [], expenses = [], remits = [] }) {
  const total = lines.reduce((s, l) => s + (l.amountCents || 0), 0)
  const byMethod = {}
  for (const l of lines) if (l.amountCents) byMethod[l.method] = (byMethod[l.method] || 0) + l.amountCents
  const onlines = lines.filter((l) => isOnline(l.method)).reduce((s, l) => s + (l.amountCents || 0), 0)
  const expenseTotal = expenses.reduce((s, e) => s + (e.amountCents || 0), 0)
  const first = remits.filter((r) => r.kind === 'first').reduce((s, r) => s + (r.amountCents || 0), 0)
  const second = remits.filter((r) => r.kind === 'second').reduce((s, r) => s + (r.amountCents || 0), 0)
  const cashOnHand = total - onlines - expenseTotal - first
  return {
    total, onlines, cash: total - onlines, byMethod, expenses: expenseTotal, firstRemit: first, secondRemit: second, cashOnHand,
    hasSecond: remits.some((r) => r.kind === 'second'), difference: second - cashOnHand, // + over, - short
    commission: lines.reduce((s, l) => s + (l.commissionCents || 0), 0), receipts: lines.filter((l) => l.amountCents).length,
  }
}
