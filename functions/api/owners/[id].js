// GET   /api/owners/:id  -> the owner with all their pets
// PATCH /api/owners/:id  {any owner fields}  -> saves only the fields sent

import { json, fail, readJson, audit } from '../../../lib/http.js'
import { ownerOut, petOut, ownerInput, setClause } from '../../../lib/clients.js'

async function load(env, id) {
  const owner = await env.DB.prepare('SELECT * FROM owners WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!owner) return null
  const { results } = await env.DB.prepare(`
    SELECT p.*, (SELECT uid FROM pet_tags t WHERE t.pet_id = p.id AND t.retired_at IS NULL LIMIT 1) AS tag_uid
    FROM pets p WHERE p.owner_id = ? AND p.deleted_at IS NULL ORDER BY p.deceased_on IS NOT NULL, p.name COLLATE NOCASE`).bind(id).all()
  return { ...ownerOut(owner), pets: results.map((r) => ({ ...petOut(r), tagUid: r.tag_uid })) }
}

export async function onRequestGet({ env, params }) {
  const owner = await load(env, Number(params.id))
  return owner ? json({ owner }) : fail(404, 'This owner was not found. They may have been removed.')
}

export async function onRequestPatch({ request, env, params, data }) {
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the changes as JSON.')
  const { values, errors } = ownerInput(body, true)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  if (!Object.keys(values).length) return fail(400, 'Nothing to change.')

  const { sql, binds } = setClause({ ...values, updated_at: new Date().toISOString() })
  const res = await env.DB.prepare(`UPDATE owners SET ${sql} WHERE id = ? AND deleted_at IS NULL`).bind(...binds, id).run()
  if (!res.meta.changes) return fail(404, 'This owner was not found. They may have been removed.')
  await audit(env, data.staff.email, 'update', 'owner', id, { fields: Object.keys(values) })
  return json({ owner: await load(env, id) })
}
