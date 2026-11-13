// The clinic's inbox intake: Cloudflare Email Routing sends mail for hello@hannapetwellnesscenter.com here.
// 1. Forward it to the clinic's private mailbox first, exactly as before (so nothing is lost if saving fails).
// 2. Save a copy to the clinic app's Inbox (D1 + attachments in R2), unless the sender is a Private Sender.
// It has no web address: only Email Routing can call it. Setup: workers/inbox-intake/README.md.

import PostalMime from 'postal-mime'
import { INBOX_ADDRESS, saveIncoming } from '../../../lib/inbox.js'

export default {
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
