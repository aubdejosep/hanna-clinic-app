// GET /api/photos/:id -> one photo from a medical record (logged-in staff only, like every /api route).
// The browser keeps it for an hour (private: never in a shared cache), so reopening a record is quick.

import { fail } from '../../../lib/http.js'

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare('SELECT key, content_type FROM medical_images WHERE id = ? AND deleted_at IS NULL').bind(Number(params.id)).first()
  if (!row) return fail(404, 'This photo was not found.')
  if (!env.PHOTOS) return fail(503, "Photo storage isn't connected yet.")
  const obj = await env.PHOTOS.get(row.key)
  if (!obj) return fail(404, "This photo hasn't been uploaded yet.")
  return new Response(obj.body, {
    headers: { 'Content-Type': row.content_type || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Length': String(obj.size) },
  })
}
