// The clinic's inbox intake: Cloudflare Email Routing sends mail for hello@hannapetwellnesscenter.com here.
// 1. Forward it to the clinic's private mailbox first, exactly as before (so nothing is lost if saving fails).
// 2. Save a copy to the clinic app's Inbox (D1 + attachments in R2), unless the sender is a Private Sender.
// 3. Facebook Page messages (Messenger): Meta's webhook at https://hooks.hannapetwellnesscenter.com/meta.
//    Every POST must carry Meta's signature (META_APP_SECRET), or it's refused unread. It can only save
//    messages; it never shows anything. Everything else on that address answers 404.
// 4. Every day at 9 AM Manila (a Cloudflare schedule, not a web address): the day-before visit reminders
//    (lib/visit-reminders.js), if switched on in Account ▸ Settings ▸ Messages.
// Setup: workers/inbox-intake/README.md and docs/MESSENGER-SETUP.md.

import PostalMime from 'postal-mime'
import { INBOX_ADDRESS, saveIncoming } from '../../../lib/inbox.js'
import { saveMessengerEvent, validSignature } from '../../../lib/messenger.js'
import { sendVisitReminders } from '../../../lib/visit-reminders.js'

const plain = (status, body = '') => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendVisitReminders(env).then((r) => console.log('visit reminders', JSON.stringify(r))).catch((err) => console.log('visit reminders failed', String(err?.stack || err).slice(0, 500))))
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname !== '/meta') return plain(404)
    if (request.method === 'GET') { // Meta's one-time check when the webhook is set up
      const ok = env.META_VERIFY_TOKEN && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env.META_VERIFY_TOKEN
      return ok ? plain(200, url.searchParams.get('hub.challenge') || '') : plain(403)
    }
    if (request.method !== 'POST') return plain(405)
    const raw = await request.arrayBuffer()
    if (raw.byteLength > 1024 * 1024 || !(await validSignature(raw, request.headers.get('x-hub-signature-256'), env.META_APP_SECRET))) return plain(403)
    let body
    try { body = JSON.parse(new TextDecoder().decode(raw)) } catch { return plain(400) }
    if (body?.object !== 'page') return plain(200)
    ctx.waitUntil((async () => {
      for (const entry of body.entry || []) {
        if (env.META_PAGE_ID && String(entry.id) !== String(env.META_PAGE_ID)) continue // only the clinic's Page
        for (const ev of entry.messaging || []) {
          try { console.log('messenger', JSON.stringify(await saveMessengerEvent(env, ev, { pageId: entry.id }))) } catch (err) { console.log('messenger save failed', String(err?.stack || err).slice(0, 500)) }
        }
      }
    })())
    return plain(200, 'EVENT_RECEIVED') // Meta wants a quick 200, or it retries
  },


  async email(message, env, ctx) {
    const raw = await new Response(message.raw).arrayBuffer()
    await message.forward(env.FORWARD_TO)
    if (String(message.to || '').toLowerCase() !== (env.INBOX_ADDRESS || INBOX_ADDRESS)) return // only hello@ is saved
    ctx.waitUntil((async () => {
      try {
        const mail = await PostalMime.parse(raw)
        const res = await saveIncoming(env, mail, { envelopeFrom: message.from })
        console.log('inbox', JSON.stringify(res))
      } catch (err) {
        console.log('inbox save failed (the email was still forwarded)', String(err?.stack || err).slice(0, 500))
      }
    })())
  },
}
