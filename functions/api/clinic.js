// GET   /api/clinic  -> business details, address, opening hours, social links, kiosk settings
// PATCH /api/clinic  {any of those}  -> owners only; saves only the fields sent

import { json, fail, readJson, canManage, audit } from '../../lib/http.js'
import { setClause } from '../../lib/clients.js'
import { clinicInput, loadClinic } from '../../lib/clinic.js'

export async function onRequestGet({ env }) {
  return json({ clinic: await loadClinic(env) })
}

export async function onRequestPatch({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change the clinic profile.')
  const body = await readJson(request)
  if (!body) return fail(400, 'Send the changes as JSON.')
  const { clinic, branch, errors } = clinicInput(body)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  const writes = []
  if (Object.keys(clinic).length) {
    const { sql, binds } = setClause({ ...clinic, updated_at: new Date().toISOString(), updated_by: data.staff.name })
    writes.push(env.DB.prepare(`UPDATE clinic SET ${sql} WHERE id = 1`).bind(...binds))
  }
  if (Object.keys(branch).length) {
    const { sql, binds } = setClause(branch)
    writes.push(env.DB.prepare(`UPDATE branches SET ${sql} WHERE id = 1`).bind(...binds))
  }
  if (!writes.length) return fail(400, 'Nothing to change.')
  await env.DB.batch(writes)
  await audit(env, data.staff.email, 'update', 'clinic', 1, { fields: [...Object.keys(clinic), ...Object.keys(branch)] })
  return json({ clinic: await loadClinic(env) })
}
