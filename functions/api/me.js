// GET /api/me -> the logged-in staff member, and the clinic logo's version (null: the built-in logo)
import { json } from '../../lib/http.js'

export async function onRequestGet({ env, data }) {
  const logo = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'logo_version'").first().catch(() => null)
  return json({ staff: data.staff, logoVersion: logo?.value || null })
}
