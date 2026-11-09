// GET  /api/owners?q=&page=&review=1&removed=1  -> owners (25 a page), newest first, with their pets' names.
//      removed=1 lists removed owners instead (most recently removed first), for Restore.
//      q matches owner name, customer number, mobile (any format), email or a pet's name.
// POST /api/owners {name, mobile, email, ..., pets: [{name, species, ...}], confirmDuplicate}
//      -> creates the owner (and pets). If the mobile is already on file, answers 409 with the
//         matches first, so the front desk can add the pet there instead of making a duplicate.

import { json, fail, readJson, likePattern, pageArgs, normalizeMobile, audit } from '../../../lib/http.js'
import { ownerOut, ownerInput, petInput, nextCustomerNo } from '../../../lib/clients.js'

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const { page, size, offset } = pageArgs(url)
  const removed = url.searchParams.get('removed') === '1'
  const where = [removed ? 'o.deleted_at IS NOT NULL' : 'o.deleted_at IS NULL']
  const binds = []

  const q = url.searchParams.get('q') || ''
  const like = likePattern(q)
  if (like) {
    const mobile = normalizeMobile(q)
    const digits = q.replace(/\D/g, '')
    where.push(`(o.full_name LIKE ? OR o.customer_no LIKE ? OR o.email LIKE ? OR o.mobile = ? OR (? != '' AND o.mobile LIKE ?)
      OR EXISTS (SELECT 1 FROM pets p WHERE p.owner_id = o.id AND p.deleted_at IS NULL AND p.name LIKE ?))`)
    binds.push(like, like, like, mobile || '-', digits.length >= 4 ? digits : '', `%${digits.replace(/^0/, '')}%`, like)
  }
  if (url.searchParams.get('review') === '1') where.push("o.review_flags != '[]'")

  const whereSql = where.join(' AND ')
  const [total, rows] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM owners o WHERE ${whereSql}`).bind(...binds),
    env.DB.prepare(`
      SELECT o.*,
        (SELECT json_group_array(json_object('id', p.id, 'name', p.name, 'species', p.species))
           FROM pets p WHERE p.owner_id = o.id AND p.deleted_at IS NULL) AS pets_json
      FROM owners o WHERE ${whereSql}
      ORDER BY ${removed ? 'o.deleted_at DESC' : 'COALESCE(o.legacy_added_on, substr(o.created_at, 1, 10)) DESC'}, o.id DESC
      LIMIT ? OFFSET ?`).bind(...binds, size, offset),
  ])
  return json({
    page,
    pageSize: size,
    total: total.results[0].n,
    owners: rows.results.map((r) => ({ ...ownerOut(r), pets: JSON.parse(r.pets_json || '[]') })),
  })
}

export async function onRequestPost({ request, env, data }) {
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the owner details as JSON.')

  const owner = ownerInput(body)
  const pets = (Array.isArray(body.pets) ? body.pets.slice(0, 10) : []).map((p) => petInput(p))
  const errors = { ...owner.errors }
  pets.forEach((p, i) => Object.entries(p.errors).forEach(([k, v]) => { errors[`pets.${i}.${k}`] = v }))
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  if (owner.values.mobile && !body.confirmDuplicate) {
    const { results } = await env.DB.prepare(
      'SELECT id, customer_no, full_name, mobile FROM owners WHERE mobile = ? AND deleted_at IS NULL LIMIT 5',
    ).bind(owner.values.mobile).all()
    if (results.length) {
      return fail(409, 'This mobile number is already on file.', {
        code: 'possible_duplicate',
        matches: results.map((r) => ({ id: r.id, customerNo: r.customer_no, name: r.full_name })),
      })
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const customerNo = await nextCustomerNo(env)
    const cols = { ...owner.values, customer_no: customerNo, source: 'staff' }
    try {
      const inserted = await env.DB.prepare(
        `INSERT INTO owners (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')}) RETURNING *`,
      ).bind(...Object.values(cols)).first()
      if (pets.length) {
        await env.DB.batch(pets.map((p) => {
          const pc = { ...p.values, owner_id: inserted.id }
          return env.DB.prepare(`INSERT INTO pets (${Object.keys(pc).join(', ')}) VALUES (${Object.keys(pc).map(() => '?').join(', ')})`)
            .bind(...Object.values(pc))
        }))
      }
      await audit(env, data.staff.email, 'create', 'owner', inserted.id, { customerNo, pets: pets.length })
      return json({ owner: ownerOut(inserted) }, 201)
    } catch (err) {
      // Two people registering at the same moment can pick the same number: take the next one.
      if (attempt === 0 && /UNIQUE.*customer_no/i.test(String(err))) continue
      throw err
    }
  }
}
