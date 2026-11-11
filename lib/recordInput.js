// What a vet writes on a visit: checking it. Who may write: vets, owners and admins.

import { clean, cleanMultiline, isoDay } from './http.js'

export const WRITERS = ['vet', 'owner', 'admin']
export const WRITE_TYPES = ['note', 'diagnosis', 'prescription', 'treatment_plan']
const PLAN_STATUS = ['active', 'on hold', 'completed', 'cancelled']
const PRIORITY = ['low', 'medium', 'high']

// -> { values: {type, title, description, details, medicines}, errors }
export function entryInput(body, { partial = false } = {}) {
  const errors = {}
  const values = {}
  if (!partial) {
    values.type = WRITE_TYPES.includes(body.type) ? body.type : null
    if (!values.type) errors.type = 'Choose what to write.'
  }
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k)
  if (has('title')) {
    values.title = clean(body.title, 120)
    if (!values.title && values.type !== 'prescription') errors.title = 'Give it a short title, e.g. Skin check.'
  }
  if (has('description')) values.description = cleanMultiline(body.description, 4000) || null
  if (has('details') && body.details && typeof body.details === 'object') {
    const d = body.details
    values.details = Object.fromEntries(Object.entries({
      status: PLAN_STATUS.includes(d.status) ? d.status : null,
      priority: PRIORITY.includes(d.priority) ? d.priority : null,
      start: isoDay(d.start),
      targetEnd: isoDay(d.targetEnd),
      objectives: cleanMultiline(d.objectives, 2000) || null,
      protocol: cleanMultiline(d.protocol, 2000) || null,
    }).filter(([, v]) => v))
  }
  if (!partial && values.type === 'prescription') {
    values.medicines = (Array.isArray(body.medicines) ? body.medicines : []).slice(0, 20).map((m) => ({
      productId: Number(m?.productId) || null,
      name: clean(m?.name, 60),
      dose: clean(m?.dose, 120) || null,
      qty: Math.max(0, Math.min(999, Number(m?.qty) || 0)),
      dispense: m?.dispense !== false,
    })).filter((m) => m.name || m.productId)
    if (!values.medicines.length && !values.description) errors.medicines = 'Add a medicine, or write the prescription below.'
  }
  return { values, errors }
}
