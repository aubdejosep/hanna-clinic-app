// Smart Prescription ▸ Medication List: checking input and shaping output (lib/html.js cleans descriptions).

import { clean } from './http.js'
import { htmlText, sanitizeHtml } from './html.js'

export const UNITS = ['ml', 'mg', 'mcg', 'g', 'IU', 'tablet', 'capsule', 'drop', 'puff', 'sachet', 'application']
export const DOSAGE_TYPES = ['Per Kg', 'Per Animal']

export function medOut(m, dosages = [], variations = []) {
  const mine = (vid) => dosages.filter((d) => (d.variation_id || null) === vid).sort((a, b) => a.sort - b.sort)
    .map((d) => ({ id: d.id, amount: d.amount, unit: d.unit, type: d.type }))
  return {
    id: m.id, name: m.name, descriptionHtml: m.description_html || '', descriptionText: m.description_text || '',
    hasImage: !!m.image_key, imageVersion: m.updated_at || m.created_at,
    addedOn: m.legacy_added_on || String(m.created_at).slice(0, 10), addedBy: m.created_by, updatedAt: m.updated_at, updatedBy: m.updated_by,
    dosages: mine(null),
    variations: variations.sort((a, b) => a.sort - b.sort).map((v) => ({ id: v.id, name: v.name, details: v.details, dosages: mine(v.id) })),
  }
}

function dosageList(list, where, errors) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((d, i) => {
    const amount = clean(String(d?.amount ?? ''), 20)
    const unit = clean(d?.unit, 30)
    const type = clean(d?.type, 30)
    if (!amount && !unit && !type) return null
    if (!amount) errors[`${where}.${i}.amount`] = 'Enter the amount, e.g. 0.6.'
    if (!unit) errors[`${where}.${i}.unit`] = 'Choose a unit.'
    if (!type) errors[`${where}.${i}.type`] = 'Choose a dosage type.'
    return { amount, unit, type }
  }).filter(Boolean)
}

// -> { values: {name, description_html, description_text}, dosages, variations: [{name, details, dosages}], errors }
export function medInput(b) {
  const errors = {}
  const name = clean(b?.name, 150)
  if (!name) errors.name = 'Enter the medication name.'
  const html = sanitizeHtml(b?.descriptionHtml)
  const dosages = dosageList(b?.dosages, 'dosages', errors)
  const variations = (Array.isArray(b?.variations) ? b.variations : []).slice(0, 20).map((v, i) => {
    const vName = clean(v?.name, 120)
    const details = clean(v?.details, 300) || null
    const vd = dosageList(v?.dosages, `variations.${i}.dosages`, errors)
    if (!vName && !details && !vd.length) return null
    if (!vName) errors[`variations.${i}.name`] = 'Name this variation, e.g. 250 mg tablet.'
    return { name: vName, details, dosages: vd }
  }).filter(Boolean)
  return { values: { name, description_html: html || null, description_text: htmlText(html).slice(0, 2000) || null }, dosages, variations, errors }
}

// Replaces a medication's dosages and variations with the ones given (the old rows are kept out of
// the way by deleting only these child rows; the medication itself is never hard-deleted).
export function childWrites(env, id, dosages, variations) {
  const w = [
    env.DB.prepare('DELETE FROM medication_dosages WHERE medication_id = ?').bind(id),
    env.DB.prepare('DELETE FROM medication_variations WHERE medication_id = ?').bind(id),
  ]
  dosages.forEach((d, i) => w.push(env.DB.prepare('INSERT INTO medication_dosages (medication_id, amount, unit, type, sort) VALUES (?, ?, ?, ?, ?)').bind(id, d.amount, d.unit, d.type, i)))
  variations.forEach((v, i) => {
    w.push(env.DB.prepare('INSERT INTO medication_variations (medication_id, name, details, sort) VALUES (?, ?, ?, ?)').bind(id, v.name, v.details, i))
    v.dosages.forEach((d, j) => w.push(env.DB.prepare(`INSERT INTO medication_dosages (medication_id, variation_id, amount, unit, type, sort)
      VALUES (?, (SELECT id FROM medication_variations WHERE medication_id = ? AND sort = ?), ?, ?, ?, ?)`).bind(id, id, i, d.amount, d.unit, d.type, j)))
  })
  return w
}

export async function loadMed(env, id) {
  const m = await env.DB.prepare('SELECT * FROM medications WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!m) return null
  const [d, v] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM medication_dosages WHERE medication_id = ?').bind(id),
    env.DB.prepare('SELECT * FROM medication_variations WHERE medication_id = ?').bind(id),
  ])
  return medOut(m, d.results, v.results)
}

// Owners, admins and vets keep the medication list; everyone can read it.
export const canEditMeds = (staff) => ['owner', 'admin', 'vet'].includes(staff?.role)
