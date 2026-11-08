// GET   /api/pets/:id  -> the pet, its owner and its NFC tag
// PATCH /api/pets/:id  {any pet fields}  -> saves only the fields sent

import { json, fail, readJson, audit } from '../../../lib/http.js'
import { petOut, ownerOut, petInput, setClause } from '../../../lib/clients.js'

async function load(env, id) {
  const pet = await env.DB.prepare('SELECT * FROM pets WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!pet) return null
  const [owner, tag] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM owners WHERE id = ?').bind(pet.owner_id),
    env.DB.prepare('SELECT uid, assigned_at FROM pet_tags WHERE pet_id = ? AND retired_at IS NULL LIMIT 1').bind(id),
  ])
  return { ...petOut(pet), owner: ownerOut(owner.results[0]), tag: tag.results[0] || null }
}

export async function onRequestGet({ env, params }) {
  const pet = await load(env, Number(params.id))
  return pet ? json({ pet }) : fail(404, 'This pet was not found. It may have been removed.')
}

export async function onRequestPatch({ request, env, params, data }) {
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the changes as JSON.')
  const { values, errors } = petInput(body, true)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  if (!Object.keys(values).length) return fail(400, 'Nothing to change.')

  const { sql, binds } = setClause({ ...values, updated_at: new Date().toISOString() })
  const res = await env.DB.prepare(`UPDATE pets SET ${sql} WHERE id = ? AND deleted_at IS NULL`).bind(...binds, id).run()
  if (!res.meta.changes) return fail(404, 'This pet was not found. It may have been removed.')
  await audit(env, data.staff.email, 'update', 'pet', id, { fields: Object.keys(values) })
  return json({ pet: await load(env, id) })
}
