// Smart Prescription ▸ Medication List.
// GET  /api/medications?q=&page=&size=&sort=name|added&dir=asc|desc -> every staff member
// POST /api/medications {name, descriptionHtml, dosages, variations} -> owners, admins and vets

import { json, fail, readJson, audit } from '../../../lib/http.js'
import { canEditMeds, childWrites, loadMed, medInput } from '../../../lib/medications.js'

export async function onRequestGet({ env, request }) {
  const u = new URL(request.url).searchParams
  const q = (u.get('q') || '').trim().slice(0, 60)
  const size = Math.min(100, Math.max(10, Number(u.get('size')) || 10))
  const page = Math.max(1, Number(u.get('page')) || 1)
  const dir = u.get('dir') === 'asc' ? 'ASC' : 'DESC'
  const order = u.get('sort') === 'name' ? `m.name COLLATE NOCASE ${dir}` : `COALESCE(m.legacy_added_on, substr(m.created_at, 1, 10)) ${dir}, m.id ${dir}`
  const where = ['m.deleted_at IS NULL']
  const binds = []
  if (q) { where.push('(m.name LIKE ? OR m.description_text LIKE ?)'); binds.push(`%${q}%`, `%${q}%`) }
  const w = where.join(' AND ')
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT m.id, m.name, m.description_text, m.image_key, m.legacy_added_on, m.created_at, m.updated_at,
        (SELECT COUNT(*) FROM medication_dosages d WHERE d.medication_id = m.id AND d.variation_id IS NULL) AS dosages,
        (SELECT COUNT(*) FROM medication_variations v WHERE v.medication_id = m.id) AS variations
      FROM medications m WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, size, (page - 1) * size),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM medications m WHERE ${w}`).bind(...binds),
  ])
  return json({
    total: count.results[0].n, page, size,
    medications: rows.results.map((m) => ({
      id: m.id, name: m.name, details: (m.description_text || '').replace(/\s+/g, ' ').slice(0, 200), hasImage: !!m.image_key, imageVersion: m.updated_at || m.created_at,
      addedOn: m.legacy_added_on || String(m.created_at).slice(0, 10), dosages: m.dosages, variations: m.variations,
    })),
  })
}

export async function onRequestPost({ request, env, data }) {
  if (!canEditMeds(data.staff)) return fail(403, 'Only vets, owners and admins can add medications.')
  const { values: v, dosages, variations, errors } = medInput(await readJson(request))
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  const row = await env.DB.prepare('INSERT INTO medications (name, description_html, description_text, created_by) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(v.name, v.description_html, v.description_text, data.staff.name).first()
  await env.DB.batch(childWrites(env, row.id, dosages, variations))
  await audit(env, data.staff.email, 'create', 'medication', row.id, { name: v.name })
  return json({ medication: await loadMed(env, row.id) }, 201)
}
