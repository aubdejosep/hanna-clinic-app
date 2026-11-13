// The email signature added under every email sent from the Inbox.
// GET -> every staff member; PUT {signature} -> owners and admins (blank puts back the default).

import { json, fail, readJson, cleanMultiline, canManage, audit } from '../../../lib/http.js'
import { getSignature, SIGNATURE } from '../../../lib/email.js'

export async function onRequestGet({ env }) {
  return json({ signature: await getSignature(env), defaultSignature: SIGNATURE })
}

export async function onRequestPut({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change the email signature.')
  const b = (await readJson(request)) || {}
  const value = cleanMultiline(b.signature, 1000) || null
  await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('email_signature', ?1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2, updated_by = ?3`).bind(value, new Date().toISOString(), data.staff.email).run()
  await audit(env, data.staff.email, 'update', 'email_signature', null)
  return json({ signature: await getSignature(env) })
}
