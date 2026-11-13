// POST /api/medications/import {medications: [...]} -> owners and admins: the old system's Medication List,
//   read by tools/medical-records-download/medications.mjs (medications.json). Matched by name, so
//   importing again updates the same medications. Returns each one's id so the screen can upload its picture.
// A medication: {name, dateAdded: "Aug. 27, 2025", descriptionHtml, dosages: [{amount, unit, type}],
//   variations: [{fields: [{label, value}]}]}

import { json, fail, readJson, canManage, audit } from '../../../lib/http.js'
import { childWrites, medInput } from '../../../lib/medications.js'
import { oldDay } from '../finances/import.js'

// A variation from the old Edit page: its name field becomes the name, the rest the details.
function variationOf(v) {
  const fields = (v?.fields || []).filter((f) => f.value)
  const nameField = fields.find((f) => /name/i.test(f.label)) || fields[0]
  if (!nameField) return null
  const dosage = {}
  const rest = []
  for (const f of fields) {
    if (f === nameField) continue
    if (/amount/i.test(f.label)) dosage.amount = f.value
    else if (/^unit/i.test(f.label)) dosage.unit = f.value
    else if (/type/i.test(f.label)) dosage.type = f.value
    else rest.push(`${f.label}: ${f.value}`)
  }
  return { name: nameField.value, details: rest.join('; '), dosages: dosage.amount ? [dosage] : [] }
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can import medications.')
  const list = (await readJson(request))?.medications
  if (!Array.isArray(list) || !list.length) return fail(400, 'The file has no medications in it.')
  if (list.length > 1000) return fail(400, 'Import up to 1,000 medications at a time.')
  const out = []
  const skipped = []
  for (const m of list) {
    const { values: v, variations, errors } = medInput({ name: m?.name, descriptionHtml: m?.descriptionHtml || (m?.descriptionText || '').replace(/\n/g, '<br>'), dosages: m?.dosages, variations: (m?.variations || []).map(variationOf).filter(Boolean) })
    if (errors.name) { skipped.push(m?.name || '(no name)'); continue }
    // An incomplete dosage from the old page (e.g. no unit) is kept with what it has rather than refused.
    const fill = (d) => ({ amount: d.amount || '?', unit: d.unit || '—', type: d.type || '—' })
    const key = v.name.toLowerCase()
    const row = await env.DB.prepare(`INSERT INTO medications (name, description_html, description_text, legacy_key, legacy_added_on, created_by)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT (legacy_key) DO UPDATE SET name = ?1, description_html = ?2, description_text = ?3, legacy_added_on = ?5, deleted_at = NULL, deleted_by = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = ?6
      RETURNING id`).bind(v.name, v.description_html, v.description_text, key, oldDay(m?.dateAdded), `${data.staff.name} (import)`).first()
    await env.DB.batch(childWrites(env, row.id, (m?.dosages || []).filter((d) => d && (d.amount || d.unit)).map(fill).slice(0, 20),
      variations.map((x) => ({ ...x, dosages: x.dosages.map(fill) }))))
    out.push({ name: v.name, id: row.id, image: m?.image || null })
  }
  await audit(env, data.staff.email, 'import', 'medications', null, { count: out.length, skipped })
  return json({ imported: out.length, skipped, medications: out }, 201)
}
