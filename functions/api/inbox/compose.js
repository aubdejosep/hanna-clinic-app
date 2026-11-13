// POST /api/inbox/compose {ownerId, subject, body} -> a new email to an owner from hello@ (every staff member).
//   Only to an owner with a real email address on file.

import { json, fail, readJson, clean, cleanMultiline, audit } from '../../../lib/http.js'
import { sendEmail, getSignature, textToHtml } from '../../../lib/email.js'
import { INBOX_ADDRESS, snippetOf } from '../../../lib/inbox.js'

export async function onRequestPost({ request, env, data }) {
  const b = (await readJson(request)) || {}
  const subject = clean(b.subject, 200)
  const body = cleanMultiline(b.body, 10000)
  if (!subject || !body) return fail(400, 'Add a subject and a message.', { errors: { ...(subject ? {} : { subject: 'Add a subject.' }), ...(body ? {} : { body: 'Write the message.' }) } })
  const o = await env.DB.prepare('SELECT id, full_name, email FROM owners WHERE id = ? AND deleted_at IS NULL').bind(Number(b.ownerId)).first()
  if (!o) return fail(404, 'This owner was not found.')
  const to = String(o.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to) || /^vpnoemail/i.test(to)) return fail(400, `${o.full_name} has no email address on file. Add one on their page first.`)
  const mid = `<${crypto.randomUUID()}@hannapetwellnesscenter.com>`
  const sig = await getSignature(env)
  const sent = await sendEmail(env, { to, subject, text: `${body}\n\n${sig.text}`, html: `<div>${textToHtml(body)}</div><div style="margin-top:16px">${sig.html}</div>`, headers: { 'Message-ID': mid } })
    .catch((err) => fail(err.status || 502, err.message))
  if (sent instanceof Response) return sent
  const now = new Date().toISOString()
  const t = await env.DB.prepare(`INSERT INTO inbox_threads (channel, subject, contact_email, contact_name, owner_id, status, unread, message_count, last_message_at, last_direction, snippet, assigned_to)
    VALUES ('email', ?, ?, ?, ?, 'open', 0, 1, ?, 'out', ?, ?) RETURNING id`).bind(subject, to, o.full_name, o.id, now, snippetOf(body), data.staff.id).first()
  await env.DB.prepare(`INSERT INTO inbox_messages (thread_id, direction, message_id, from_email, from_name, to_emails, subject, text_body, status, provider_id, sent_by, staff_id, created_at)
    VALUES (?, 'out', ?, ?, 'Hanna Pet Wellness Center', ?, ?, ?, 'sent', ?, ?, ?, ?)`).bind(t.id, mid, INBOX_ADDRESS, to, subject, body, sent.id, data.staff.name, data.staff.id, now).run()
  await audit(env, data.staff.email, 'compose', 'inbox_thread', t.id, { ownerId: o.id })
  return json({ id: t.id }, 201)
}
