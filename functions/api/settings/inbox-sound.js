// The Inbox notification sound played when new messages arrive. Logged-in staff only, like every /api route.
// GET    /api/settings/inbox-sound -> the uploaded audio file, or 404 when the built-in sound is used
// PUT    /api/settings/inbox-sound (body: audio file, up to 2 MB) -> owners and admins
// DELETE /api/settings/inbox-sound -> owners and admins: back to the built-in sound
// /api/me carries inboxSoundVersion, so browsers cache immutably and refresh after a change.

import { json, fail, canManage, audit } from '../../../lib/http.js'

const KEY = 'branding/inbox-sound'
const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm',
])

export async function onRequestGet({ env }) {
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  const obj = await env.PHOTOS.get(KEY)
  if (!obj) return fail(404, 'No custom sound has been uploaded.')
  const contentType = obj.httpMetadata?.contentType || 'audio/mpeg'
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Length': String(obj.size),
    },
  })
}

export async function onRequestPut({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change the inbox sound.')
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED.has(type)) return fail(400, 'Please pick an MP3, WAV, OGG, or M4A audio file.')
  if ((Number(request.headers.get('Content-Length')) || 0) > MAX_BYTES) return fail(413, 'This sound file is too large. Keep it under 2 MB.')
  const buf = await request.arrayBuffer()
  if (!buf.byteLength) return fail(400, 'The sound file is empty.')
  if (buf.byteLength > MAX_BYTES) return fail(413, 'This sound file is too large. Keep it under 2 MB.')
  await env.PHOTOS.put(KEY, buf, { httpMetadata: { contentType: type } })
  const version = String(Date.now())
  const now = new Date().toISOString()
  await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('inbox_sound_version', ?1, ?2, ?3)
    ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2, updated_by = ?3`).bind(version, now, data.staff.name).run()
  await audit(env, data.staff.email, 'inbox_sound', 'settings', null, { version, type, bytes: buf.byteLength })
  return json({ inboxSoundVersion: version })
}

export async function onRequestDelete({ env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change the inbox sound.')
  await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('inbox_sound_version', NULL, ?1, ?2)
    ON CONFLICT (key) DO UPDATE SET value = NULL, updated_at = ?1, updated_by = ?2`).bind(new Date().toISOString(), data.staff.name).run()
  await audit(env, data.staff.email, 'inbox_sound_reset', 'settings', null)
  return json({ inboxSoundVersion: null })
}
