// Finances ▸ Daily Cash: the clinic's daily cash book (the paper ledger), worked out the same way on the
// screen and the server. No imports.
//
//   Total collected - Onlines - Expenses - 1st Remit = Cash On Hand (what the 2nd Remit should be)
//   Vet commission per receipt = generic meds x 10% + doctor's fee x 100% + surgery x 20% + P50 per lab test
//   (the rates can be changed; a line's commission can also be typed by hand). Commission isn't taken out
//   of the cash: it's a running total, as in the ledger.

export const METHODS = [
  { key: 'cash', label: 'Cash', code: 'Cash', online: false },
  { key: 'gcash', label: 'GCash', code: 'G', online: true },
  { key: 'bank', label: 'Bank Transfer', code: 'B', online: true },
  { key: 'maribank', label: 'MariBank', code: 'MB', online: true },
  { key: 'card', label: 'Credit Card', code: 'CC', online: true },
  { key: 'qrph', label: 'QRPH', code: 'QR', online: true },
  { key: 'maya', label: 'Maya', code: 'Maya', online: true },
  { key: 'other', label: 'Other (Online)', code: 'Other', online: true },
]
export const methodOf = (key) => METHODS.find((m) => m.key === key) || METHODS[0]
export const EXPENSE_TYPES = ['Supplies', 'Medicines & Stock', 'Food', 'Transport', 'Utilities', 'Repairs & Maintenance', 'Vet Commission', 'Other']
export const DEFAULT_RATES = { medsPct: 10, doctorPct: 100, surgeryPct: 20, labCents: 5000 }

export function cleanRates(r) {
  const n = (v, d, max) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= max ? x : d }
  return { medsPct: n(r?.medsPct, 10, 100), doctorPct: n(r?.doctorPct, 100, 100), surgeryPct: n(r?.surgeryPct, 20, 100), labCents: Math.round(n(r?.labCents, 5000, 10000000)) }
}

// The commission the formula gives (cents).
export function calcCommission(l, rates = DEFAULT_RATES) {
  return Math.round((l.medsCents || 0) * rates.medsPct / 100 + (l.doctorCents || 0) * rates.doctorPct / 100 + (l.surgeryCents || 0) * rates.surgeryPct / 100 + (l.labTests || 0) * rates.labCents)
}
// What counts: the typed figure if there is one, else the formula.
export const commissionOf = (l, rates) => (l.commissionCents != null ? l.commissionCents : calcCommission(l, rates))

export function summarize({ lines = [], expenses = [], remits = [] }, rates = DEFAULT_RATES) {
  const live = lines.filter((l) => !l.voided)
  const total = live.reduce((s, l) => s + (l.amountCents || 0), 0)
  const byMethod = {}
  for (const l of live) byMethod[l.method] = (byMethod[l.method] || 0) + (l.amountCents || 0)
  const onlines = live.filter((l) => methodOf(l.method).online).reduce((s, l) => s + (l.amountCents || 0), 0)
  const expenseTotal = expenses.reduce((s, e) => s + e.amountCents, 0)
  const first = remits.filter((r) => r.kind === 'first').reduce((s, r) => s + r.amountCents, 0)
  const second = remits.filter((r) => r.kind === 'second').reduce((s, r) => s + r.amountCents, 0)
  const cashOnHand = total - onlines - expenseTotal - first
  const commission = {}
  for (const l of live) {
    const c = commissionOf(l, rates)
    if (!c) continue
    const who = l.vetName || 'No vet chosen'
    commission[who] = (commission[who] || 0) + c
  }
  return {
    total, onlines, cash: total - onlines, byMethod, expenses: expenseTotal, firstRemit: first, secondRemit: second, cashOnHand,
    hasSecond: remits.some((r) => r.kind === 'second'), difference: second - cashOnHand, // + over, - short
    commission, commissionTotal: Object.values(commission).reduce((a, b) => a + b, 0), receipts: live.length,
  }
}

// Commission breakdown for a receipt taken in the app, from its items (staff can correct it).
// kind: 'doctor' | 'surgery' | 'lab' | 'meds' | null, from the service's category and name, or a product's category.
const LAB = /(lab|blood ?chem|cbc|x-?ray|ultrasound|ecg|t3|t4|para ?m[ea]t|biopsy|urinalysis|fecalysis|skin test|microscope|test kit|rapid test|smear|cytology)/i
const SURGERY = /(surg|spay|castrat|neuter|cesarean|caesarean|pyometra|dental|extraction|hematoma|anal sac|cystotomy|enucleat|amputat|tumou?r removal)/i
const DOCTOR = /(consult|check ?up|doctor|professional fee|vet fee|home service)/i
export function itemKind({ kind, category, name }) {
  const text = `${category || ''} ${name || ''}`
  if (kind === 'product') return /medicine|generic/i.test(category || '') ? 'meds' : null
  if (LAB.test(text)) return 'lab'
  if (SURGERY.test(text)) return 'surgery'
  if (DOCTOR.test(text)) return 'doctor'
  return null
}
export function breakdown(items) {
  const b = { medsCents: 0, doctorCents: 0, surgeryCents: 0, labTests: 0 }
  for (const it of items) {
    const k = itemKind(it)
    const amount = Math.round((it.priceCents || 0) * (it.qty || 1))
    if (k === 'meds') b.medsCents += amount
    else if (k === 'doctor') b.doctorCents += amount
    else if (k === 'surgery') b.surgeryCents += amount
    else if (k === 'lab') b.labTests += Math.max(1, Math.round(it.qty || 1))
  }
  return b
}
