# Inbox intake (email to hello@)

Cloudflare Email Routing sends mail for **hello@hannapetwellnesscenter.com** to this small Worker. For every email it:

1. **forwards it to the clinic's private mailbox** (`hannapetwellnesscenter@atomicmail.io`, set in `wrangler.toml`), first, so nothing is lost if anything after fails;
2. **saves a copy to the clinic app's Inbox** (text, attachments up to 20 MB each), unless the sender is on the **Private Senders** list (Inbox ▸ settings, owners and admins).

It has no web address (`workers_dev = false`): only Email Routing can call it. Other addresses on the domain are untouched.

## Setup (once, about 10 minutes)

From the `hanna-clinic-app` folder in PowerShell:

1. Update the database (adds the Inbox tables):
   ```
   git pull
   npm run db:migrate:remote
   ```
2. Let the clinic app send replies from hello@ (Resend, the same service the website uses). In Resend, create an API key
   with **Sending access** for hannapetwellnesscenter.com (or reuse the website's), then:
   ```
   npx wrangler pages secret put RESEND_API_KEY --project-name hanna-clinic-app
   ```
   Paste the key when asked. Then redeploy the app (push or retry the latest deployment) so it picks it up.
3. Deploy this Worker:
   ```
   cd workers\inbox-intake
   npm install
   npx wrangler deploy
   ```
4. In Cloudflare: **your domain ▸ Email ▸ Email Routing ▸ Routing rules**, edit the **hello@hannapetwellnesscenter.com** rule:
   **Action: Send to a Worker ▸ hanna-inbox-intake ▸ Save.**
   (The private mailbox stays a verified destination address; the Worker forwards to it.)
5. Send a test email to hello@ from your own email. Within a minute it should be in the private mailbox **and** in the
   app's Inbox. Reply from the app, and check the reply arrives in your mailbox in the same conversation.

**To undo:** set the hello@ rule's action back to **Send to an email ▸ hannapetwellnesscenter@atomicmail.io**.
Mail then goes only to the private mailbox, as before.

**If something's off:** Cloudflare ▸ Workers & Pages ▸ hanna-inbox-intake ▸ Logs. A line `inbox {"threadId":…}` means
it was saved; `inbox save failed (the email was still forwarded)` shows why it wasn't.

## Facebook Page messages (Messenger)

The same Worker also receives the Facebook Page's messages at `https://hooks.hannapetwellnesscenter.com/meta`
(Meta's webhook, refused unless signed by Meta). Setup: `docs/MESSENGER-SETUP.md`.
