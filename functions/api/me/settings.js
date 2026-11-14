// PATCH /api/me/settings {theme, textSize, fonts} -> the logged-in person's display settings (follow them to any device)

import { json, fail, readJson, audit } from '../../../lib/http.js'
import { cleanFonts } from '../../../lib/fonts.js'

export const THEMES = ['brand', 'contrast', 'classic']
export const TEXT_SIZES = ['standard', 'large', 'larger']

export async function onRequestPatch({ request, env, data }) {
  const b = (await readJson(request)) || {}
  const sets = []
  const binds = []
  if ('theme' in b) {
    if (!THEMES.includes(b.theme)) return fail(400, 'Choose a theme.')
    sets.push('theme = ?'); binds.push(b.theme)
  }
  if ('textSize' in b) {
    if (!TEXT_SIZES.includes(b.textSize)) return fail(400, 'Choose a text size.')
    sets.push('text_size = ?'); binds.push(b.textSize)
  }
  if ('fonts' in b) { sets.push('fonts = ?'); binds.push(JSON.stringify(cleanFonts(b.fonts))) }
  if (!sets.length) return fail(400, 'Nothing to change.')
  await env.DB.prepare(`UPDATE staff SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...binds, new Date().toISOString(), data.staff.id).run()
  await audit(env, data.staff.email, 'settings', 'staff', data.staff.id, b)
  return json({ theme: b.theme ?? data.staff.theme, textSize: b.textSize ?? data.staff.textSize, fonts: 'fonts' in b ? cleanFonts(b.fonts) : data.staff.fonts })
}
