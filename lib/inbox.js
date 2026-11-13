// Inbox: shared by the email Worker (workers/inbox-intake, saving mail to hello@) and the app's /api/inbox.

import { htmlText, sanitizeHtml } from './html.js'

export const INBOX_ADDRESS = 'hello@hannapetwellnesscenter.com'
const lower = (s) => String(s || '').trim().toLowerCase()
const baseSubject = (s) => String(s || '').replace(/^\s*((re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase()
export const snippetOf = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160)

// Private Senders: an exact address, or "@domain" for the whole domain.
export async function isPrivateSender(env, email) {
  const e = lower(email)
  if (!e) return false
  const { results } = await env.DB.prepare('SELECT pattern FROM inbox_private_senders WHERE deleted_at IS NULL').all()
  return results.some((r) => { const p = lower(r.pattern); return p.startsWith('@') ? e.endsWith(p) : e === p })
}

// The conversation an email belongs to: the one holding the message it replies to; else this sender's
// open conversation with the same subject from the last 30 days; else a new one.
async function threadFor(env, { from, fromName, subject, inReplyTo, references }) {
  const ids = [inReplyTo, ...String(references || '').split(/\s+/)].map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20)
  if (ids.length) {
    const row = await env.DB.prepare(`SELECT thread_id FROM inbox_messages WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`).bind(...ids).first()
    if (row) return row.thread_id
  }
  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const { results } = await env.DB.prepare(`SELECT id, subject FROM inbox_threads WHERE contact_email = ? AND deleted_at IS NULL AND status <> 'spam' AND last_message_at >= ? ORDER BY last_message_at DESC LIMIT 10`)
    .bind(lower(from), since).all()
  const same = results.find((t) => baseSubject(t.subject) === baseSubject(subject))
  if (same) return same.id
  const owner = await env.DB.prepare(`SELECT CASE WHEN COUNT(*) = 1 THEN MAX(id) END AS id FROM owners WHERE deleted_at IS NULL AND lower(email) = ?`).bind(lower(from)).first()
  const t = await env.DB.prepare(`INSERT INTO inbox_threads (channel, subject, contact_email, contact_name, owner_id, status, unread, message_count) VALUES ('email', ?, ?, ?, ?, 'open', 1, 0) RETURNING id`)
    .bind(String(subject || '(no subject)').slice(0, 300), lower(from), fromName || null, owner?.id || null).first()
  return t.id
}

// Saves one parsed incoming email (postal-mime's shape). -> { threadId, messageId } or { skipped }
export async function saveIncoming(env, mail, { envelopeFrom } = {}) {
  const from = lower(mail.from?.address || envelopeFrom)
  if (await isPrivateSender(env, from)) return { skipped: 'private' }
  const mid = String(mail.messageId || '').trim() || null
  if (mid) { // the same email twice (a retry): keep one
    const dup = await env.DB.prepare('SELECT id, thread_id FROM inbox_messages WHERE message_id = ? AND direction = ?').bind(mid, 'in').first()
    if (dup) return { threadId: dup.thread_id, messageId: dup.id, duplicate: true }
  }
  const text = String(mail.text || htmlText(mail.html) || '').slice(0, 100000)
  const html = mail.html ? sanitizeHtml(mail.html, 200000) : null
  const subject = String(mail.subject || '(no subject)').slice(0, 300)
  const threadId = await threadFor(env, { from, fromName: mail.from?.name, subject, inReplyTo: mail.inReplyTo, references: mail.references })
  const list = (xs) => (xs || []).map((x) => x.address).filter(Boolean).join(', ').slice(0, 1000) || null
  const now = new Date().toISOString()
  const msg = await env.DB.prepare(`INSERT INTO inbox_messages (thread_id, direction, message_id, in_reply_to, references_h, from_email, from_name, to_emails, cc_emails, subject, text_body, html_body, status, created_at)
    VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?) RETURNING id`)
    .bind(threadId, mid, mail.inReplyTo || null, String(mail.references || '').slice(0, 2000) || null, from, mail.from?.name || null, list(mail.to), list(mail.cc), subject, text, html, now).first()
  let saved = 0
  if (env.PHOTOS) {
    for (const [i, a] of (mail.attachments || []).entries()) {
      const bytes = a.content?.byteLength ?? a.content?.length ?? 0
      if (!bytes || bytes > 20 * 1024 * 1024 || i >= 10) continue
      const name = String(a.filename || `attachment-${i + 1}`).replace(/[^\w.() -]/g, '_').slice(0, 120)
      const key = `inbox/${msg.id}/${i}-${name}`
      await env.PHOTOS.put(key, a.content, { httpMetadata: { contentType: a.mimeType || 'application/octet-stream' } })
      await env.DB.prepare('INSERT INTO inbox_attachments (message_id, r2_key, filename, content_type, bytes) VALUES (?, ?, ?, ?, ?)').bind(msg.id, key, name, a.mimeType || null, bytes).run()
      saved += 1
    }
  }
  await env.DB.prepare(`UPDATE inbox_threads SET unread = 1, status = CASE WHEN status = 'spam' THEN 'spam' ELSE 'open' END, message_count = message_count + 1,
    last_message_at = ?, last_direction = 'in', snippet = ?, updated_at = ? WHERE id = ?`).bind(now, snippetOf(text), now, threadId).run()
  return { threadId, messageId: msg.id, attachments: saved }
}
