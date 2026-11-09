// GET    /api/services/:id  -> one service with its variations (everyone)
// PATCH  /api/services/:id  {any fields, variations?} -> owners only
// DELETE /api/services/:id  -> owners only; hides it from the list (past appointments keep its name)

import { json, fail, readJson, canManage, audit } from '../../../lib/http.js'
import { setClause } from '../../../lib/clients.js'
import { serviceOut, serviceInput, categoryId, saveVariations } from '../../../lib/services.js'

async function load(env, id) {
  const row = await env.DB.prepare(`SELECT s.*, c.name AS category_name FROM services s
    LEFT JOIN service_categories c ON c.id = s.category_id WHERE s.id = ? AND s.deleted_at IS NULL`).bind(id).first()
  if (!row) return null
  const { results } = await env.DB.prepare('SELECT * FROM service_variations WHERE service_id = ? AND active = 1 ORDER BY sort, id').bind(id).all()
  return serviceOut(row, results)
}

export async function onRequestGet({ env, params }) {
  const service = await load(env, Number(params.id))
  return service ? json({ service }) : fail(404, 'This service was not found. It may have been removed.')
}

export async function onRequestPatch({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change services.')
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the changes as JSON.')
  const { values, variations, category, errors } = serviceInput(body, true)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  if (category) values.category_id = await categoryId(env, category)

  const { sql, binds } = setClause({ ...values, updated_at: new Date().toISOString() })
  const res = await env.DB.prepare(`UPDATE services SET ${sql} WHERE id = ? AND deleted_at IS NULL`).bind(...binds, id).run()
  if (!res.meta.changes) return fail(404, 'This service was not found. It may have been removed.')
  if (variations) await saveVariations(env, id, variations)
  await audit(env, data.staff.email, 'update', 'service', id, { fields: Object.keys(values), variations: variations?.length })
  return json({ service: await load(env, id) })
}

export async function onRequestDelete({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can remove services.')
  const id = Number(params.id)
  const res = await env.DB.prepare('UPDATE services SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(new Date().toISOString(), data.staff.name, id).run()
  if (!res.meta.changes) return fail(404, 'This service was not found, or was already removed.')
  await audit(env, data.staff.email, 'remove', 'service', id)
  return json({ ok: true })
}
