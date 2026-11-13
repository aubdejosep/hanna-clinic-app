// GET /api/photos/:id -> one photo from a medical record (logged-in staff only, like every /api route),
//   for viewing. ?download=1 saves it as a file: owners and admins only (record downloads are theirs).
// The browser keeps it for an hour (private: never in a shared cache), so reopening a record is quick.

import { fail, canManage, audit } from '../../../lib/http.js'

export async function onRequestGet({ env, params, request, data }) {
  const download = new URL(request.url).searchParams.get('download') === '1'
  if (download && !canManage(data.staff)) return fail(403, 'Downloading records is for the clinic owners and admins.')
  const row = await env.DB.prepare('SELECT key, content_type FROM medical_images WHERE id = ? AND deleted_at IS NULL').bind(Number(params.id)).first()
  if (!row) return fail(404, 'This photo was not found.')
  if (!env.PHOTOS) return fail(503, "Photo storage isn't connected yet.")
  const obj = await env.PHOTOS.get(row.key)
  if (!obj) return fail(404, "This photo hasn't been uploaded yet.")
  const headers = { 'Content-Type': row.content_type || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Length': String(obj.size) }
  if (download) {
    headers['Content-Disposition'] = `attachment; filename="medical-photo-${Number(params.id)}.${(row.content_type || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg')}"`
    await audit(env, data.staff.email, 'download', 'medical_image', Number(params.id))
  }
  return new Response(obj.body, { headers })
}
