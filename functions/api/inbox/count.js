// GET /api/inbox/count -> unread open conversations, for the menu badge (one small read)

import { json } from '../../../lib/http.js'

export async function onRequestGet({ env }) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM inbox_threads WHERE status = 'open' AND unread = 1 AND deleted_at IS NULL").first()
  return json({ unread: r.n })
}
