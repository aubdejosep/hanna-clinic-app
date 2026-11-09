// GET   /api/staff/:id  -> one staff member
// PATCH /api/staff/:id  {any staff fields, password?, active?} -> saves only the fields sent
//
// Setting a password here (an owner resetting it) or switching someone off logs them out
// everywhere. Owners can't switch themselves off or drop their own owner role, and the clinic
// always keeps at least one active owner.

import { json, fail, readJson, canManage, audit } from '../../../lib/http.js'
import { hashPassword, passwordProblem } from '../../../lib/password.js'
import { setClause } from '../../../lib/clients.js'
import { staffOut, staffInput } from '../../../lib/staffing.js'

async function load(env, id) {
  const row = await env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first()
  if (!row) return null
  const { results } = await env.DB.prepare('SELECT kind, updated_at FROM staff_images WHERE staff_id = ?').bind(id).all()
  const images = Object.fromEntries(results.map((r) => [r.kind, true]))
  images.updatedAt = results.map((r) => r.updated_at).sort().pop() || null
  return staffOut(row, images)
}

export async function onRequestGet({ env, params, data }) {
  const id = Number(params.id)
  if (!canManage(data.staff) && id !== data.staff.id) return fail(403, 'Only a clinic owner can open staff details.')
  const staff = await load(env, id)
  return staff ? json({ staff }) : fail(404, 'This staff member was not found.')
}

export async function onRequestPatch({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change staff details.')
  const id = Number(params.id)
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the changes as JSON.')
  const current = await env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first()
  if (!current) return fail(404, 'This staff member was not found.')

  const { values, errors } = staffInput(body, true)
  if (body.password) {
    const problem = passwordProblem(body.password)
    if (problem) errors.password = problem
  }
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  if (id === data.staff.id) {
    if (values.active === 0) return fail(400, "You can't switch off your own account.")
    if (values.role && values.role !== current.role && current.role === 'owner') return fail(400, "You can't remove your own owner role. Ask the other owner to do it.")
  }
  const losingOwner = current.role === 'owner' && current.active && ((values.role && values.role !== 'owner') || values.active === 0)
  if (losingOwner) {
    const owners = await env.DB.prepare("SELECT COUNT(*) AS n FROM staff WHERE role = 'owner' AND active = 1").first()
    if (owners.n <= 1) return fail(400, 'The clinic needs at least one active owner.')
  }
  if (values.email && values.email !== current.email.toLowerCase()) {
    const taken = await env.DB.prepare('SELECT id FROM staff WHERE email = ? AND id != ?').bind(values.email, id).first()
    if (taken) return fail(409, 'Someone already logs in with this email.', { errors: { email: 'Someone already logs in with this email.' } })
  }

  const now = new Date().toISOString()
  if (body.password) Object.assign(values, { password_hash: await hashPassword(body.password), failed_logins: 0, locked_until: null })
  if (body.unlock) Object.assign(values, { failed_logins: 0, locked_until: null })
  if (!Object.keys(values).length) return fail(400, 'Nothing to change.')

  const { sql, binds } = setClause({ ...values, updated_at: now })
  const writes = [env.DB.prepare(`UPDATE staff SET ${sql} WHERE id = ?`).bind(...binds, id)]
  const logOut = !!body.password || values.active === 0
  if (logOut && id !== data.staff.id) {
    writes.push(env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL').bind(now, id))
  }
  await env.DB.batch(writes)
  await audit(env, data.staff.email, 'update', 'staff', id, {
    fields: Object.keys(values).filter((k) => k !== 'password_hash'), passwordReset: !!body.password,
  })
  return json({ staff: await load(env, id) })
}
