// GET  /api/services?q=&category=&status=active|inactive|all  -> the price list (everyone)
// POST /api/services {name, description, price, category, active, featuredOnline, variations} -> owners only

import { json, fail, readJson, canManage, likePattern, audit } from '../../../lib/http.js'
import { serviceOut, serviceInput, categoryId, saveVariations } from '../../../lib/services.js'

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const where = ['s.deleted_at IS NULL']
  const binds = []
  const like = likePattern(url.searchParams.get('q'))
  if (like) {
    where.push('(s.name LIKE ? OR s.description LIKE ? OR c.name LIKE ?)')
    binds.push(like, like, like)
  }
  const cat = Number(url.searchParams.get('category'))
  if (cat) { where.push('s.category_id = ?'); binds.push(cat) }
  const status = url.searchParams.get('status') || 'all'
  if (status === 'active') where.push('s.active = 1')
  if (status === 'inactive') where.push('s.active = 0')

  const [services, categories] = await env.DB.batch([
    env.DB.prepare(`
      SELECT s.*, c.name AS category_name,
        (SELECT COUNT(*) FROM service_variations v WHERE v.service_id = s.id AND v.active = 1) AS variation_count
      FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.name COLLATE NOCASE, s.name COLLATE NOCASE`).bind(...binds),
    env.DB.prepare(`SELECT c.id, c.name, COUNT(s.id) AS services FROM service_categories c
      LEFT JOIN services s ON s.category_id = c.id AND s.deleted_at IS NULL
      GROUP BY c.id ORDER BY c.name COLLATE NOCASE`),
  ])
  return json({
    services: services.results.map((r) => serviceOut(r)),
    categories: categories.results.map((c) => ({ id: c.id, name: c.name, services: c.services })),
  })
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can add services.')
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the service details as JSON.')
  const { values, variations, category, errors } = serviceInput(body)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  const cols = { ...values, category_id: await categoryId(env, category) }
  const row = await env.DB.prepare(
    `INSERT INTO services (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')}) RETURNING id`,
  ).bind(...Object.values(cols)).first()
  if (variations?.length) await saveVariations(env, row.id, variations)
  await audit(env, data.staff.email, 'create', 'service', row.id, { name: values.name })
  return json({ id: row.id }, 201)
}
