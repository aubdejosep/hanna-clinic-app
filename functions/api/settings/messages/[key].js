// PATCH /api/settings/messages/:key {smsEnabled, emailEnabled, smsText, emailSubject, emailIntro} -> owners and admins.
// Fill-ins must be ones this message has; Text can only be switched on once texting is set up.

import { json, fail, readJson, clean, cleanMultiline, canManage, audit } from '../../../../lib/http.js'
import { smsReady } from '../../../../lib/sms.js'
import { EMAIL_REQUIRED, unknownFillIns } from '../../../../lib/messages.js'
import { shapeTemplate } from './index.js'

export async function onRequestPatch({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change the clinic’s messages.')
  const t = await env.DB.prepare('SELECT * FROM message_templates WHERE key = ?').bind(String(params.key)).first()
  if (!t) return fail(404, 'This message was not found.')
  const b = (await readJson(request)) || {}
  const next = {
    sms_enabled: b.smsEnabled ? 1 : 0, email_enabled: b.emailEnabled ? 1 : 0,
    sms_text: cleanMultiline(b.smsText, 459), email_subject: clean(b.emailSubject, 200), email_intro: cleanMultiline(b.emailIntro, 1000),
  }
  const allowed = JSON.parse(t.fill_ins || '[]')
  const errors = {}
  if (!next.sms_text) errors.smsText = 'Write the text message.'
  if (!next.email_subject) errors.emailSubject = 'Write the email subject.'
  if (!next.email_intro) errors.emailIntro = 'Write the email’s opening line.'
  for (const [k, f] of [['smsText', 'sms_text'], ['emailSubject', 'email_subject'], ['emailIntro', 'email_intro']]) {
    const bad = unknownFillIns(next[f], allowed)
    if (bad.length && !errors[k]) errors[k] = `This message can’t fill in ${bad.map((x) => `{${x}}`).join(', ')}. Use: ${allowed.map((x) => `{${x}}`).join(', ')}.`
  }
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  if (EMAIL_REQUIRED.includes(t.key)) next.email_enabled = 1 // always emailed (the change link, the code)
  if (next.sms_enabled && !smsReady(env)) return fail(400, 'Texting isn’t set up yet. Switch Text on once the sender name is approved and its keys are added.')
  const now = new Date().toISOString()
  await env.DB.prepare('UPDATE message_templates SET sms_enabled = ?, email_enabled = ?, sms_text = ?, email_subject = ?, email_intro = ?, updated_at = ?, updated_by = ? WHERE key = ?')
    .bind(next.sms_enabled, next.email_enabled, next.sms_text, next.email_subject, next.email_intro, now, data.staff.name, t.key).run()
  await audit(env, data.staff.email, 'update', 'message_template', t.key, { sms: !!next.sms_enabled, email: !!next.email_enabled })
  return json({ template: shapeTemplate(await env.DB.prepare('SELECT * FROM message_templates WHERE key = ?').bind(t.key).first()) })
}
