// Facebook Page messages (Messenger) in the Inbox. Shared by the intake Worker (workers/inbox-intake, which
// receives Meta's webhook) and the app (replies). Setup: docs/MESSENGER-SETUP.md.
//
//   * Meta POSTs each Page message to the Worker, signed with the app secret (X-Hub-Signature-256).
//     Anything unsigned or wrongly signed is refused before it's read.
//   * One conversation per client (their Page-scoped ID, PSID). Photos and files are copied into R2,
//     because Meta's links expire.
//   * Replies sent from Meta Business Suite arrive as "echoes" and are saved too, so the thread is
//     complete. Replies sent from the app are saved when sent; their echo is recognised and skipped.
//   * Meta's rule: free replies within 24 hours of the client's last message. With META_HUMAN_AGENT = "1"
//     (only after Meta approves the Human Agent permission), staff can reply for up to 7 days.
// Keys are Cloudflare secrets: META_PAGE_TOKEN (Worker and app), META_APP_SECRET and META_VERIFY_TOKEN (Worker).

import { snippetOf } from './inbox.js'

export const GRAPH = 'https://graph.facebook.com/v23.0'
export const WINDOW_MS = 24 * 3600 * 1000
export const HUMAN_AGENT_MS = 7 * 24 * 3600 * 1000
const MAX_FILE = 20 * 1024 * 1024

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

// Meta signs the raw body: "sha256=" + HMAC-SHA256(app secret). Compared in constant time.
export async function validSignature(raw, header, secret) {
  if (!secret || !header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const want = hex(await crypto.subtle.sign('HMAC', key, raw))
  const got = header.slice(7).toLowerCase()
  let diff = want.length ^ got.length
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (got.charCodeAt(i) || 0)
  return diff === 0
}

// What the reply box may do now: { ok, tag, reason }.
export function replyWindow(thread, env, now = Date.now()) {
  const last = Date.parse(thread.last_in_at || '')
  if (!last) return { ok: false, reason: 'This client hasn’t messaged the Page yet, so Messenger won’t let the clinic write first.' }
  const age = now - last
  if (age <= WINDOW_MS) return { ok: true, tag: null, until: new Date(last + WINDOW_MS).toISOString() }
  if (env.META_HUMAN_AGENT === '1' && age <= HUMAN_AGENT_MS) return { ok: true, tag: 'HUMAN_AGENT', until: new Date(last + HUMAN_AGENT_MS).toISOString() }
  return { ok: false, reason: env.META_HUMAN_AGENT === '1'
    ? 'It’s been over 7 days since the client’s last message, so Messenger won’t deliver a reply. Call or email them instead.'
    : 'It’s been over 24 hours since the client’s last message, so Messenger won’t deliver a reply. Call or email them, or reply when they message again.' }
}

async function profileName(env, psid) {
  if (!env.META_PAGE_TOKEN) return null
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(psid)}?fields=first_name,last_name&access_token=${encodeURIComponent(env.META_PAGE_TOKEN)}`)
    if (!r.ok) return null
    const p = await r.json()
    return [p.first_name, p.last_name].filter(Boolean).join(' ').slice(0, 120) || null
  } catch { return null }
}

const KIND_LABEL = { image: 'Photo', video: 'Video', audio: 'Voice message', file: 'File', fallback: 'Link' }

// Saves one Messenger webhook event (entry[].messaging[]). -> { threadId, messageId } or { skipped }
export async function saveMessengerEvent(env, ev, { pageId } = {}) {
  const msg = ev.message || (ev.postback ? { mid: ev.postback.mid, text: ev.postback.title } : null)
  if (!msg?.mid) return { skipped: 'not a message' } // deliveries, reads, reactions
  const echo = !!msg.is_echo
  const psid = String(echo ? ev.recipient?.id : ev.sender?.id || '')
  if (!psid || psid === String(pageId || '')) return { skipped: 'no client' }
  if (await env.DB.prepare('SELECT 1 FROM inbox_messages WHERE message_id = ? LIMIT 1').bind(msg.mid).first()) return { skipped: 'already saved' }
  const at = new Date(Number(ev.timestamp) || Date.now()).toISOString()

  let t = await env.DB.prepare("SELECT * FROM inbox_threads WHERE channel = 'messenger' AND external_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").bind(psid).first()
  if (!t) {
    if (echo) return { skipped: 'echo without a conversation' } // the Page wrote first (e.g. an ad reply)
    const name = (await profileName(env, psid)) || 'Facebook user'
    t = await env.DB.prepare(`INSERT INTO inbox_threads (channel, subject, contact_name, external_id, status, unread, message_count) VALUES ('messenger', 'Messenger', ?, ?, 'open', 1, 0) RETURNING *`)
      .bind(name, psid).first()
  }

  const files = (msg.attachments || []).filter((a) => a?.payload?.url).slice(0, 10)
  const text = String(msg.text || '').slice(0, 20000) || files.map((a) => `[${KIND_LABEL[a.type] || 'Attachment'}]`).join(' ') || (msg.sticker_id ? '[Sticker]' : '')
  const row = await env.DB.prepare(`INSERT INTO inbox_messages (thread_id, direction, message_id, from_name, subject, text_body, status, sent_by, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?) RETURNING id`)
    .bind(t.id, echo ? 'out' : 'in', msg.mid, echo ? 'Hanna Pet Wellness Center' : t.contact_name, text, echo ? 'sent' : 'received', echo ? 'Facebook Page' : null, at).first()

  if (env.PHOTOS) {
    for (const [i, a] of files.entries()) {
      try {
        const r = await fetch(a.payload.url)
        const bytes = Number(r.headers.get('content-length') || 0)
        if (!r.ok || bytes > MAX_FILE) continue
        const body = await r.arrayBuffer()
        if (body.byteLength > MAX_FILE) continue
        const type = (r.headers.get('content-type') || 'application/octet-stream').split(';')[0]
        const ext = (type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5)
        const name = `${(KIND_LABEL[a.type] || 'attachment').toLowerCase().replace(/\s+/g, '-')}-${i + 1}.${ext}`
        const key = `inbox/${row.id}/${i}-${name}`
        await env.PHOTOS.put(key, body, { httpMetadata: { contentType: type } })
        await env.DB.prepare('INSERT INTO inbox_attachments (message_id, r2_key, filename, content_type, bytes) VALUES (?, ?, ?, ?, ?)').bind(row.id, key, name, type, body.byteLength).run()
      } catch (err) { console.log('messenger file not saved', String(err).slice(0, 200)) }
    }
  }

  if (echo) {
    await env.DB.prepare(`UPDATE inbox_threads SET message_count = message_count + 1, last_message_at = ?, last_direction = 'out', snippet = ?, updated_at = ? WHERE id = ?`)
      .bind(at, snippetOf(text), at, t.id).run()
  } else {
    await env.DB.prepare(`UPDATE inbox_threads SET unread = 1, status = CASE WHEN status = 'spam' THEN 'spam' ELSE 'open' END, message_count = message_count + 1,
      last_message_at = ?, last_in_at = ?, last_direction = 'in', snippet = ?, updated_at = ? WHERE id = ?`).bind(at, at, snippetOf(text), at, t.id).run()
  }
  return { threadId: t.id, messageId: row.id }
}

// Sends a text reply from the Page. -> { mid } or throws an Error with a plain-English message.
export async function sendMessenger(env, psid, text, { tag } = {}) {
  if (!env.META_PAGE_TOKEN) throw Object.assign(new Error('Messenger replies aren’t set up yet. Add the META_PAGE_TOKEN secret (docs/MESSENGER-SETUP.md).'), { status: 503 })
  const res = await fetch(`${env.META_GRAPH_URL || GRAPH}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: tag ? 'MESSAGE_TAG' : 'RESPONSE',
      ...(tag ? { tag } : {}),
      message: { text },
      access_token: env.META_PAGE_TOKEN,
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(`Messenger didn’t send it: ${body?.error?.message || `error ${res.status}`}. Try again, or call or email the client.`), { status: 502 })
  return { mid: body?.message_id || null }
}
