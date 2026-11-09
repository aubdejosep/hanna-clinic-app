// POST /api/pets/:id/restore -> brings a removed pet back. Owners and admins only.

import { json, fail, canManage, audit } from '../../../../lib/http.js'

export async function onRequestPost({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can restore pets. Ask one of them to do it.')
  const id = Number(params.id)
  const res = await env.DB.prepare('UPDATE pets SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
    .bind(new Date().toISOString(), id).run()
  if (!res.meta.changes) return fail(404, "This pet isn't in the removed list anymore.")
  await audit(env, data.staff.email, 'restore', 'pet', id)
  return json({ ok: true })
}
