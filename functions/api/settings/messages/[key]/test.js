// POST /api/settings/messages/:key/test {mobile, email} -> owners and admins: the saved message, with sample
// details, to their own phone and/or email (whichever of Text / Email is on).

import { json, fail, readJson, clean, isEmail, canManage, audit } from '../../../../../lib/http.js'
import { sendEmail } from '../../../../../lib/email.js'
import { sendSms } from '../../../../../lib/sms.js'
import { SAMPLE, fillIn } from '../../../../../lib/messages.js'
import { clientEmail } from '../../../../../lib/client-email.js'

export async function onRequestPost({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can send test messages.')
  const t = await env.DB.prepare('SELECT * FROM message_templates WHERE key = ?').bind(String(params.key)).first()
  if (!t) return fail(404, 'This message was not found.')
  const b = (await readJson(request)) || {}
  const mobile = clean(b.mobile, 20)
  const email = clean(b.email, 120).toLowerCase()
  const sent = []
  const problems = []
  if (t.sms_enabled && mobile) {
    try { await sendSms(env, mobile, fillIn(t.sms_text)); sent.push('text') } catch (err) { problems.push(err.message) }
  }
  if (t.email_enabled && email) {
    if (!isEmail(email)) problems.push('That email address doesn’t look right.')
    else {
      try {
        await sendEmail(env, { to: email, ...clientEmail({ subject: `[Test] ${fillIn(t.email_subject)}`, intro: fillIn(t.email_intro), firstName: SAMPLE.first_name, note: 'This is a test with sample details. The real email also has the booking details and buttons.' }) })
        sent.push('email')
      } catch (err) { problems.push(err.message) }
    }
  }
  if (!sent.length && !problems.length) return fail(400, t.sms_enabled || t.email_enabled ? 'Enter your mobile or email under Send Tests To, for the channels that are on.' : 'Switch on Text or Email first.')
  await audit(env, data.staff.email, 'test_message', 'message_template', t.key, { sent })
  if (!sent.length) return fail(502, problems.join(' '))
  return json({ sent, problems })
}
