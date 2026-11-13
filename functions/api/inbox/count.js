// GET /api/inbox/count -> unread open conversations, for the menu badge (one small read)

import { json } from '../../../lib/http.js'
import { visible } from '../../../lib/inbox.js'

export async function onRequestGet({ env, data }) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM inbox_threads t WHERE status = 'open' AND unread = 1 AND deleted_at IS NULL${visible(data.staff)}`).first()
  return json({ unread: r.n })
}
