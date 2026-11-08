// GET  /api/pets?q=&species=&page=  -> pets with their owner (25 a page)
//      q matches pet name, breed, microchip, owner name or customer number.
// POST /api/pets {ownerId, name, species, ...}  -> adds a pet to an existing owner

import { json, fail, readJson, likePattern, pageArgs, audit } from '../../../lib/http.js'
import { petOut, petInput, localMobile, SPECIES } from '../../../lib/clients.js'

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const { page, size, offset } = pageArgs(url)
  const where = ['p.deleted_at IS NULL', 'o.deleted_at IS NULL']
  const binds = []
  const like = likePattern(url.searchParams.get('q'))
  if (like) {
    where.push('(p.name LIKE ? OR p.breed LIKE ? OR p.microchip LIKE ? OR o.full_name LIKE ? OR o.customer_no LIKE ?)')
    binds.push(like, like, like, like, like)
  }
  const species = url.searchParams.get('species')
  if (SPECIES.includes(species)) {
    where.push('p.species = ?')
    binds.push(species)
  }
  const whereSql = where.join(' AND ')
  const from = 'FROM pets p JOIN owners o ON o.id = p.owner_id'
  const [total, rows] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${whereSql}`).bind(...binds),
    env.DB.prepare(`SELECT p.*, o.full_name AS owner_name, o.customer_no, o.mobile AS owner_mobile ${from} WHERE ${whereSql}
      ORDER BY p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`).bind(...binds, size, offset),
  ])
  return json({
    page,
    pageSize: size,
    total: total.results[0].n,
    pets: rows.results.map((r) => ({
      ...petOut(r),
      owner: { id: r.owner_id, name: r.owner_name, customerNo: r.customer_no, mobileLocal: localMobile(r.owner_mobile) },
    })),
  })
}

export async function onRequestPost({ request, env, data }) {
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the pet details as JSON.')
  const ownerId = Number(body.ownerId)
  const owner = ownerId && await env.DB.prepare('SELECT id FROM owners WHERE id = ? AND deleted_at IS NULL').bind(ownerId).first()
  if (!owner) return fail(400, 'Choose the owner this pet belongs to.')
  const { values, errors } = petInput(body)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  const cols = { ...values, owner_id: ownerId }
  const pet = await env.DB.prepare(
    `INSERT INTO pets (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')}) RETURNING *`,
  ).bind(...Object.values(cols)).first()
  await audit(env, data.staff.email, 'create', 'pet', pet.id, { ownerId })
  return json({ pet: petOut(pet) }, 201)
}
