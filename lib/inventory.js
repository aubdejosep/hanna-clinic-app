// Product details from the Product List forms: checking input.

import { clean } from './http.js'
import { toCents } from './services.js'
import { UNITS } from './stock.js'

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[,\s]/g, '')))

// -> { values (database columns), errors }
export function productInput(body, partial = false) {
  const values = {}
  const errors = {}
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k)
  if (has('name')) { values.name = clean(body.name, 60); if (!values.name) errors.name = 'Enter the product name.' }
  if (has('category')) values.category = clean(body.category, 40) || null
  if (has('unit')) { values.unit = UNITS.includes(body.unit) ? body.unit : 'piece' }
  if (has('packName')) values.pack_name = clean(body.packName, 20) || null
  if (has('packSize')) {
    const n = num(body.packSize)
    if (n !== null && !(n > 0 && n < 100000)) errors.packSize = 'Enter how many units come in one, e.g. 100.'
    else values.pack_size = n
  }
  for (const [k, col] of [['price', 'price_cents'], ['cost', 'cost_cents']]) {
    if (!has(k)) continue
    if (body[k] === '' || body[k] == null) { values[col] = null; continue }
    const c = toCents(body[k])
    if (c === null) errors[k] = 'Enter an amount, e.g. 35.50.'
    else values[col] = c
  }
  if (has('reorderLevel')) {
    const n = num(body.reorderLevel)
    if (n !== null && !(n >= 0 && n < 100000)) errors.reorderLevel = 'Enter a number, e.g. 10.'
    else values.reorder_level = n
  }
  if (has('active')) values.active = body.active ? 1 : 0
  return { values, errors }
}

export const qtyOf = (v) => { const n = num(v); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null }
