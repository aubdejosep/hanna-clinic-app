// GET /api/me -> the logged-in staff member, plus clinic logo and inbox sound versions (null: built-in defaults)
import { json } from '../../lib/http.js'

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare("SELECT key, value FROM app_settings WHERE key IN ('logo_version', 'inbox_sound_version')").all().catch(() => ({ results: [] }))
  const map = Object.fromEntries(results.map((r) => [r.key, r.value]))
  return json({ staff: data.staff, logoVersion: map.logo_version || null, inboxSoundVersion: map.inbox_sound_version || null })
}
