// GET /api/settings/messages -> owners and admins: every message template (Account ▸ Settings ▸ Messages),
// and whether texting and email are set up.

import { json, fail, canManage } from '../../../../lib/http.js'
import { smsReady } from '../../../../lib/sms.js'

export const shapeTemplate = (t) => ({
  key: t.key, smsEnabled: !!t.sms_enabled, emailEnabled: !!t.email_enabled, smsText: t.sms_text, emailSubject: t.email_subject, emailIntro: t.email_intro,
  defaults: { smsText: t.default_sms_text, emailSubject: t.default_email_subject, emailIntro: t.default_email_intro },
  fillIns: JSON.parse(t.fill_ins || '[]'), updatedAt: t.updated_at, updatedBy: t.updated_by,
})

export async function onRequestGet({ env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change the clinic’s messages.')
  const { results } = await env.DB.prepare('SELECT * FROM message_templates ORDER BY sort').all()
  return json({ templates: results.map(shapeTemplate), smsReady: smsReady(env), emailReady: !!env.RESEND_API_KEY, senderName: env.SEMAPHORE_SENDER_NAME || 'HANNAPETVET' })
}
