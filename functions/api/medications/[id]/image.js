// GET    /api/medications/:id/image -> the medication's picture (logged-in staff)
// PUT    /api/medications/:id/image (body: JPG/PNG/WebP up to 5 MB) -> owners, admins and vets
// DELETE /api/medications/:id/image -> owners, admins and vets

import { json, fail, audit } from '../../../../lib/http.js'
import { canEditMeds } from '../../../../lib/medications.js'

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export async function onRequestGet({ env, params }) {
  const m = await env.DB.prepare('SELECT image_key, image_type FROM medications WHERE id = ? AND deleted_at IS NULL').bind(Number(params.id)).first()
  if (!m?.image_key || !env.PHOTOS) return fail(404, 'No picture for this medication.')
  const obj = await env.PHOTOS.get(m.image_key)
  if (!obj) return fail(404, 'No picture for this medication.')
  return new Response(obj.body, { headers: { 'Content-Type': m.image_type || 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'Content-Length': String(obj.size) } })
}

export async function onRequestPut({ request, env, params, data }) {
  if (!canEditMeds(data.staff)) return fail(403, 'Only vets, owners and admins can change medications.')
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  const id = Number(params.id)
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  if (!EXT[type]) return fail(400, 'Use a JPG, PNG or WebP picture.')
  if ((Number(request.headers.get('Content-Length')) || 0) > 5 * 1024 * 1024) return fail(413, 'This picture is over 5 MB. Use a smaller one.')
  const m = await env.DB.prepare('SELECT id, image_key FROM medications WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!m) return fail(404, 'This medication was not found.')
  const key = `medications/${id}.${EXT[type]}`
  await env.PHOTOS.put(key, request.body, { httpMetadata: { contentType: type } })
  if (m.image_key && m.image_key !== key) await env.PHOTOS.delete(m.image_key).catch(() => {})
  await env.DB.prepare('UPDATE medications SET image_key = ?, image_type = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(key, type, new Date().toISOString(), data.staff.name, id).run()
  await audit(env, data.staff.email, 'set_image', 'medication', id)
  return json({ ok: true })
}

export async function onRequestDelete({ env, params, data }) {
  if (!canEditMeds(data.staff)) return fail(403, 'Only vets, owners and admins can change medications.')
  const id = Number(params.id)
  await env.DB.prepare('UPDATE medications SET image_key = NULL, image_type = NULL, updated_at = ?, updated_by = ? WHERE id = ?').bind(new Date().toISOString(), data.staff.name, id).run()
  await audit(env, data.staff.email, 'clear_image', 'medication', id)
  return json({ ok: true })
}
