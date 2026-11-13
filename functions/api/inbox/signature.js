// The email signature added under every email sent from the Inbox (formatted: links, pictures, colours).
// GET -> every staff member; PUT {html} -> owners and admins (blank puts back the default).

import { json, fail, readJson, canManage, audit } from '../../../lib/http.js'
import { getSignature, SIGNATURE, textToHtml } from '../../../lib/email.js'
import { htmlText, sanitizeSignature } from '../../../lib/html.js'

const view = async (env) => { const s = await getSignature(env); return { html: s.html, saved: s.saved, defaultHtml: textToHtml(SIGNATURE) } }

export async function onRequestGet({ env }) {
  return json(await view(env))
}

export async function onRequestPut({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change the email signature.')
  const b = (await readJson(request)) || {}
  const raw = typeof b.html === 'string' ? b.html : ''
  if (raw.length > 12000) return fail(400, 'This signature is too long. Keep it to a few lines.')
  const html = sanitizeSignature(raw)
  const value = htmlText(html) || /<img/.test(html) ? html : null // nothing left: back to the default
  await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('email_signature', ?1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2, updated_by = ?3`).bind(value, new Date().toISOString(), data.staff.email).run()
  await audit(env, data.staff.email, 'update', 'email_signature', null)
  return json(await view(env))
}
