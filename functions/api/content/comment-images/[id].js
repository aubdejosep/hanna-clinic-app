// GET /api/content/comment-images/:id -> an image on a Content comment (logged-in staff only).

import { fail } from '../../../../lib/http.js'

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare(`SELECT i.r2_key, i.content_type FROM content_comment_images i JOIN content_comments c ON c.id = i.comment_id
    WHERE i.id = ? AND i.deleted_at IS NULL AND c.deleted_at IS NULL`).bind(Number(params.id)).first()
  if (!row) return fail(404, 'This image was not found.')
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  const obj = await env.PHOTOS.get(row.r2_key)
  if (!obj) return fail(404, "This image hasn't been uploaded yet.")
  return new Response(obj.body, { headers: { 'Content-Type': row.content_type, 'Cache-Control': 'private, max-age=86400', 'Content-Length': String(obj.size) } })
}
