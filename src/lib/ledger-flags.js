// Finances ▸ Ledger: what needs a person's attention on a receipt row, and on the whole day. Shown on the row (the
// Status column) and in the Needs Attention list. Flags never block anything: they say what to look at.
const peso = (c) => `₱${((c || 0) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
const short = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const FIELD = { receipt_no: 'receipt number', client: 'owner’s name', pet: 'pet’s name', items: 'items', discount: 'discount', total: 'total', paid_hint: 'payment', date: 'date' }
const LABEL = { receiptNo: 'OR', receiptQr: 'QR', clientName: 'Owner’s Name', petNames: 'Pet’s Name', amountCents: 'Total', discountCents: 'Discounts', paidWith: 'Paid With' }

// -> [{ text, open }]: open = still to sort out (counts for Needs Attention); otherwise just information.
export function flagsOf(row, day) {
  const out = []
  const items = (row.items || []).reduce((n, i) => n + (i.amountCents || 0), 0)
  if (row.items?.length && row.amountCents && items - (row.discountCents || 0) !== row.amountCents) {
    out.push({ open: true, text: `Items${row.discountCents ? ' less discount' : ''} come to ${peso(items - (row.discountCents || 0))}, not ${peso(row.amountCents)}` })
  }
  const num = row.receiptQr || row.receiptNo
  if (!num && (row.clientName || row.amountCents)) out.push({ open: true, text: 'No receipt number' })
  for (const d of row.dupes || []) out.push({ open: true, text: d.day === row.day ? `Receipt ${num} is on this day twice` : `Receipt ${num} is also on ${short(d.day)}` })
  if (!row.photo && row.stage !== 'owner') out.push({ open: false, text: 'No photo' })
  const ai = row.ai
  if (ai && row.stage === 'draft') {
    if (ai.error) out.push({ open: true, text: 'The app couldn’t read the photo: type it in' })
    else if (ai.notReceipt) out.push({ open: true, text: 'The app thinks this photo isn’t a receipt' })
    else if (ai.unclear?.length) out.push({ open: true, text: `The app wasn’t sure of the ${ai.unclear.map((k) => FIELD[k] || k).join(', ')}` })
  }
  if (ai?.date && day && ai.date !== row.day) out.push({ open: true, text: `The slip is dated ${short(ai.date)}` })
  // What a person changed from what the app read (information for the owner checking).
  if (ai?.values && !ai.error) {
    const changed = Object.keys(LABEL).filter((k) => k in ai.values && ai.values[k] != null && ai.values[k] !== '' && String(ai.values[k]) !== String(row[k] ?? ''))
    if (changed.length) out.push({ open: false, text: `Changed from what the app read: ${changed.map((k) => LABEL[k]).join(', ')}` })
  }
  if (row.issueNote) out.push({ open: true, text: `To discuss: ${row.issueNote}` })
  return out
}

// Numbers missing in the day's runs of QR and OR slips (e.g. QR 05333 between 05332 and 05334). Only small gaps:
// a jump of more than 5 is a different booklet.
export function gapsOf(lines) {
  const out = []
  for (const [k, label] of [['receiptQr', 'QR'], ['receiptNo', 'OR']]) {
    const nums = [...new Set(lines.map((l) => l[k]).filter((v) => /^\d+$/.test(v || '')))].map(Number).sort((a, b) => a - b)
    const width = (lines.find((l) => l[k]) || {})[k]?.length || 5
    for (let i = 1; i < nums.length; i++) {
      const gap = nums[i] - nums[i - 1]
      if (gap > 1 && gap <= 6) for (let n = nums[i - 1] + 1; n < nums[i]; n++) out.push(`${label} ${String(n).padStart(width, '0')} is missing (between ${String(nums[i - 1]).padStart(width, '0')} and ${String(nums[i]).padStart(width, '0')})`)
    }
  }
  return out
}
