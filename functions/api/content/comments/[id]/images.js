// PUT /api/content/comments/:id/images?n=0..3  (body: the image) -> the comment's author adds a
//   screenshot or example image (JPG, PNG, WebP or GIF, up to 10 MB; up to 4 per comment).

import { json, fail } from '../../../../../lib/http.js'

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export async function onRequestPut({ request, env, params, data }) {
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  const id = Number(params.id)
  const c = await env.DB.prepare('SELECT id, staff_id FROM content_comments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!c) return fail(404, 'This comment was not found.')
  if (c.staff_id !== data.staff.id) return fail(403, 'Only the person who wrote the comment can add images to it.')
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  if (!EXT[type]) return fail(400, 'Add a JPG, PNG, WebP or GIF image.')
  if ((Number(request.headers.get('Content-Length')) || 0) > 10 * 1024 * 1024) return fail(413, 'This image is over 10 MB. Use a smaller screenshot.')
  const n = Math.max(0, Math.min(3, Number(new URL(request.url).searchParams.get('n')) || 0))
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS k FROM content_comment_images WHERE comment_id = ? AND deleted_at IS NULL').bind(id).all()
  if (results[0].k >= 4) return fail(400, 'A comment can have up to 4 images.')
  const key = `content/comments/${id}-${n}.${EXT[type]}`
  const obj = await env.PHOTOS.put(key, request.body, { httpMetadata: { contentType: type } })
  const row = await env.DB.prepare('INSERT INTO content_comment_images (comment_id, sort, r2_key, content_type, bytes) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(id, n, key, type, obj?.size ?? null).first()
  return json({ id: row.id }, 201)
}
