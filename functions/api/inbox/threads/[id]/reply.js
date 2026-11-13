// POST /api/inbox/threads/:id/reply {body} -> sends a reply from hello@ (every staff member), threaded so it
//   lands in the client's same conversation, with the clinic's signature and the last email quoted below.

import { json, fail, readJson, cleanMultiline, audit } from '../../../../../lib/http.js'
import { sendEmail, SIGNATURE, textToHtml } from '../../../../../lib/email.js'
import { INBOX_ADDRESS, snippetOf } from '../../../../../lib/inbox.js'
import { loadThread } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = cleanMultiline((await readJson(request))?.body, 10000)
  if (!body) return fail(400, 'Write your reply first.')
  const t = await env.DB.prepare('SELECT * FROM inbox_threads WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!t) return fail(404, 'This conversation was not found.')
  if (t.channel !== 'email' || !t.contact_email) return fail(400, 'This conversation has no email address to reply to.')
  const last = await env.DB.prepare("SELECT * FROM inbox_messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").bind(id).first()
  const lastIn = await env.DB.prepare("SELECT * FROM inbox_messages WHERE thread_id = ? AND direction = 'in' ORDER BY created_at DESC, id DESC LIMIT 1").bind(id).first()
  const subject = /^re:/i.test(t.subject || '') ? t.subject : `Re: ${t.subject || 'Your message'}`
  const mid = `<${crypto.randomUUID()}@hannapetwellnesscenter.com>`
  const refs = [last?.references_h, last?.message_id].filter(Boolean).join(' ').split(/\s+/).filter(Boolean).slice(-10).join(' ')
  const quoted = lastIn ? `\n\nOn ${new Date(lastIn.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}, ${lastIn.from_name || lastIn.from_email} wrote:\n${String(lastIn.text_body || '').split('\n').slice(0, 40).map((l) => `> ${l}`).join('\n')}` : ''
  const text = `${body}\n\n${SIGNATURE}${quoted}`
  const html = `<div>${textToHtml(body)}</div><p style="color:#5E6785">${textToHtml(SIGNATURE)}</p>${lastIn ? `<blockquote style="margin:0;padding-left:10px;border-left:3px solid #ddd;color:#666">${textToHtml(quoted.trim())}</blockquote>` : ''}`
  const headers = { 'Message-ID': mid, ...(last?.message_id ? { 'In-Reply-To': last.message_id, References: refs } : {}) }
  const now = new Date().toISOString()
  let sent
  let error = null
  try { sent = await sendEmail(env, { to: t.contact_email, subject, text, html, headers }) } catch (err) { error = err }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO inbox_messages (thread_id, direction, message_id, in_reply_to, references_h, from_email, from_name, to_emails, subject, text_body, status, error, provider_id, sent_by, staff_id, created_at)
      VALUES (?, 'out', ?, ?, ?, ?, 'Hanna Pet Wellness Center', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, mid, last?.message_id || null, refs || null, INBOX_ADDRESS, t.contact_email, subject, body, error ? 'failed' : 'sent', error ? error.message : null, sent?.id || null, data.staff.name, data.staff.id, now),
    ...(error ? [] : [env.DB.prepare(`UPDATE inbox_threads SET message_count = message_count + 1, last_message_at = ?, last_direction = 'out', snippet = ?, unread = 0, updated_at = ? WHERE id = ?`).bind(now, snippetOf(body), now, id)]),
  ])
  await audit(env, data.staff.email, error ? 'reply_failed' : 'reply', 'inbox_thread', id)
  if (error) return fail(error.status || 502, error.message)
  return json({ thread: await loadThread(env, id, data.staff) }, 201)
}
