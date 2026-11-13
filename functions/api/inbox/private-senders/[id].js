// DELETE /api/inbox/private-senders/:id -> owners and admins; their new mail is saved in the Inbox again

import { json, fail, canManage, audit } from '../../../../lib/http.js'

export async function onRequestDelete({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Private Senders are for the clinic owners and admins.')
  const r = await env.DB.prepare('UPDATE inbox_private_senders SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(new Date().toISOString(), data.staff.name, Number(params.id)).run()
  if (!r.meta.changes) return fail(404, 'Not found.')
  await audit(env, data.staff.email, 'delete', 'inbox_private_sender', Number(params.id))
  return json({ ok: true })
}
