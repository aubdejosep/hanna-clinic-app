// The clinic logo shown in the app (sidebar, top bar, Clinic Profile). Logged-in staff only, like every /api route.
// GET    /api/settings/logo     -> the uploaded logo (PNG, square), or 404 when the built-in one is used
// PUT    /api/settings/logo     (body: PNG, cropped square in the browser) -> owners and admins
// DELETE /api/settings/logo     -> owners and admins: back to the built-in logo
// /api/me carries logoVersion, so screens know which to show and browsers refresh after a change.

import { json, fail, canManage, audit } from '../../../lib/http.js'

const KEY = 'branding/logo.png'

export async function onRequestGet({ env }) {
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  const obj = await env.PHOTOS.get(KEY)
  if (!obj) return fail(404, 'No logo has been uploaded.')
  return new Response(obj.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Length': String(obj.size) } })
}

export async function onRequestPut({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change the clinic logo.')
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'image/png') return fail(400, 'Crop the logo in the app, then save it.')
  if ((Number(request.headers.get('Content-Length')) || 0) > 3 * 1024 * 1024) return fail(413, 'This logo is too large. Use a smaller image.')
  await env.PHOTOS.put(KEY, request.body, { httpMetadata: { contentType: 'image/png' } })
  const version = String(Date.now())
  const now = new Date().toISOString()
  await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('logo_version', ?1, ?2, ?3)
    ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2, updated_by = ?3`).bind(version, now, data.staff.name).run()
  await audit(env, data.staff.email, 'logo', 'settings', null, { version })
  return json({ logoVersion: version })
}

export async function onRequestDelete({ env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change the clinic logo.')
  await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('logo_version', NULL, ?1, ?2)
    ON CONFLICT (key) DO UPDATE SET value = NULL, updated_at = ?1, updated_by = ?2`).bind(new Date().toISOString(), data.staff.name).run()
  await audit(env, data.staff.email, 'logo_reset', 'settings', null)
  return json({ logoVersion: null })
}
