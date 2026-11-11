// DELETE /api/clinic/closed-dates/:id  -> owners only; removes a closed date (soft delete)

import { json, fail, canManage, audit } from '../../../../lib/http.js'
import { loadClinic } from '../../../../lib/clinic.js'

export async function onRequestDelete({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change opening hours.')
  const id = Number(params.id)
  const res = await env.DB.prepare('UPDATE closed_dates SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(new Date().toISOString(), data.staff.name, id).run()
  if (!res.meta.changes) return fail(404, 'This date was not found.')
  await audit(env, data.staff.email, 'remove', 'closed_date', id, null)
  return json({ clinic: await loadClinic(env) })
}
