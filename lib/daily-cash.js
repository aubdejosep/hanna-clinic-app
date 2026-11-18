// Finances ▸ Ledger: the clinic's cash ledger, typed in like a spreadsheet, one row per receipt, in the clinic's
// own sheet layout. Totals are worked out the same way on the screen and the server. No imports.
//
//   Total Income (before discounts) - Discounts = Net Income
//   Net Income - Online Payments = Cash
//   Cash - Expenses - 1st Remit = Cash On Hand (what the 2nd Remit should be)
//   Commissions are typed per receipt and added up; they aren't taken out of the cash.
//   Discounts only count on receipts that count (a slip with Total Income left blank is left out).

export const EXPENSE_TYPES = ['Supplies', 'Medicines & Stock', 'Food', 'Transport', 'Utilities', 'Repairs & Maintenance', 'Vet Commission', 'Other']
export const MONEY_COLUMNS = ['amountCents', 'discountCents', 'onlineCents', 'depositCents', 'balanceCents', 'incomeCents', 'commissionCents']

const sum = (list, k) => list.reduce((s, x) => s + (x[k] || 0), 0)
export function summarize({ lines = [], expenses = [], remits = [] }) {
  const income = sum(lines, 'incomeCents')
  const discounts = lines.reduce((s, l) => s + (l.incomeCents != null ? l.discountCents || 0 : 0), 0)
  const net = income - discounts
  const online = sum(lines, 'onlineCents')
  const expenseTotal = sum(expenses, 'amountCents')
  const first = sum(remits.filter((r) => r.kind === 'first'), 'amountCents')
  const second = sum(remits.filter((r) => r.kind === 'second'), 'amountCents')
  const cashOnHand = net - online - expenseTotal - first
  return {
    receiptsTotal: sum(lines, 'amountCents'), income, discounts, net, online, cash: net - online, deposits: sum(lines, 'depositCents'), balances: sum(lines, 'balanceCents'),
    expenses: expenseTotal, firstRemit: first, secondRemit: second, cashOnHand, hasSecond: remits.some((r) => r.kind === 'second'),
    difference: second - cashOnHand, commission: sum(lines, 'commissionCents'),
    receipts: lines.filter((l) => l.receiptNo || l.receiptQr || l.clientName || l.amountCents || l.incomeCents).length,
  }
}
