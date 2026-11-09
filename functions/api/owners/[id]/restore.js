// POST /api/owners/:id/restore -> brings a removed owner (and their pets) back. Owners and admins only.

import { json, fail, canManage, audit } from '../../../../lib/http.js'

export async function onRequestPost({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can restore clients. Ask one of them to do it.')
  const id = Number(params.id)
  const res = await env.DB.prepare('UPDATE owners SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
    .bind(new Date().toISOString(), id).run()
  if (!res.meta.changes) return fail(404, "This owner isn't in the removed list anymore.")
  await audit(env, data.staff.email, 'restore', 'owner', id)
  return json({ ok: true })
}
