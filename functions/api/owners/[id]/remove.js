// POST /api/owners/:id/remove   -> hides the owner (and so their pets) from lists and search
// POST /api/owners/:id/restore  -> brings them back (functions/api/owners/[id]/restore.js)
// Nothing is erased: the row keeps everything and gets deleted_at / deleted_by.
// Owners and admins only.

import { json, fail, canManage, audit } from '../../../../lib/http.js'

export async function onRequestPost({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can remove clients. Ask one of them to do it.')
  const id = Number(params.id)
  const res = await env.DB.prepare('UPDATE owners SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(new Date().toISOString(), data.staff.name, id).run()
  if (!res.meta.changes) return fail(404, 'This owner was not found, or was already removed.')
  await audit(env, data.staff.email, 'remove', 'owner', id)
  return json({ ok: true })
}
