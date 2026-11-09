// GET  /api/staff?all=1  -> staff list (owners see everyone; ?all=1 includes switched-off staff)
// POST /api/staff {firstName, lastName, email, phone, role, title, password, ...} -> adds a staff member
// Adding and editing staff is for the clinic owners.

import { json, fail, readJson, canManage, audit } from '../../../lib/http.js'
import { hashPassword, passwordProblem } from '../../../lib/password.js'
import { staffOut, staffInput } from '../../../lib/staffing.js'

export async function onRequestGet({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can open the staff list.')
  const all = new URL(request.url).searchParams.get('all') === '1'
  const { results } = await env.DB.prepare(`
    SELECT s.*,
      (SELECT 1 FROM staff_images i WHERE i.staff_id = s.id AND i.kind = 'photo') AS has_photo,
      (SELECT 1 FROM staff_images i WHERE i.staff_id = s.id AND i.kind = 'signature') AS has_signature,
      (SELECT MAX(updated_at) FROM staff_images i WHERE i.staff_id = s.id) AS images_at
    FROM staff s ${all ? '' : 'WHERE s.active = 1'}
    ORDER BY s.active DESC, CASE s.role WHEN 'owner' THEN 0 WHEN 'vet' THEN 1 ELSE 2 END, s.first_name COLLATE NOCASE`).all()
  return json({
    staff: results.map((r) => staffOut(r, { photo: r.has_photo, signature: r.has_signature, updatedAt: r.images_at })),
  })
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can add staff.')
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the staff details as JSON.')
  const { values, errors } = staffInput(body)
  const problem = passwordProblem(body.password)
  if (problem) errors.password = problem
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  const taken = await env.DB.prepare('SELECT id FROM staff WHERE email = ?').bind(values.email).first()
  if (taken) return fail(409, 'Someone already logs in with this email.', { errors: { email: 'Someone already logs in with this email.' } })

  const cols = { ...values, password_hash: await hashPassword(body.password), active: 1 }
  const row = await env.DB.prepare(
    `INSERT INTO staff (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')}) RETURNING *`,
  ).bind(...Object.values(cols)).first()
  await audit(env, data.staff.email, 'create', 'staff', row.id, { email: row.email, role: row.role })
  return json({ staff: staffOut(row) }, 201)
}
