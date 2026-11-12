# Inbox: plan and requirements

One **Inbox** in the clinic app for the clinic's conversations: email to and from
**hello@hannapetwellnesscenter.com**, and SMS to and from the clinic's SMS number. Staff read, reply,
see who the client is (Masterlist), and mark conversations done.

Status: **planning.** SMS provider still to choose (Semaphore or Promotexter).

## Decisions (Nov 2026)

1. hello@ is on **Cloudflare Email Routing**, forwarding to the clinic's private mailbox
   (hannapetwellnesscenter@atomicmail.io). The app taps in at Cloudflare: **only mail addressed to
   hello@** is saved, and it is still forwarded to the mailbox exactly as now (backup copy: yes).
2. **All staff** read the Inbox.
3. **The private mailbox is never connected to the app.** It receives confidential and finance mail,
   so nothing sent from or received only by it appears in the app: no mailbox login, no syncing,
   no Bcc. Replies to clients are written in the app.
4. SMS: one-to-one replies first, then **reminders and promos soon after**.
5. Keep forwarding every hello@ email to the mailbox as a backup.

## What the Inbox does

- **One list of conversations**, newest first, email and SMS together, with an envelope or SMS mark.
  Tabs: Open, Mine, Done, All. Unread counts on the menu.
- **A conversation** shows the whole thread (in and out), who it is (matched to an owner by email or
  mobile, with their pets and upcoming appointments), and a reply box.
- **Reply** by email (from hello@, threaded so it lands in the client's same email thread) or SMS
  (from the clinic's number), with **quick replies** (templates: directions, hours, how to book,
  "please send a photo").
- **Assign** a conversation to a staff member; **Done** to close it (a new message reopens it).
- **Internal notes** on a conversation (staff only, never sent).
- **On the owner's page:** their messages, so the vets see the history at a visit.
- **New conversation**: email or SMS an owner from their page.

## Requirements: email (hello@)

You already send and receive at hello@. To show mail **in the app**, it has to reach the app:

| Need | How | Notes |
|---|---|---|
| Receive into the app | The **hello@** route in Cloudflare Email Routing points to an **Email Worker** that saves the message (text, HTML, attachments) and **forwards it** to the atomicmail mailbox, as today | Other addresses on the domain keep their current routes and never reach the app. If the Worker ever fails, the mail is still forwarded. |
| Send from the app | **Resend** (already set up for the domain) | Replies get `In-Reply-To` / `References` headers so they thread in Gmail and Outlook. |
| Replies sent from the private mailbox | **Never shown in the app** (owners' decision: that mailbox holds confidential and finance mail) | Staff reply to clients from the app. |
| Confidential mail sent to hello@ | A **Private Senders** list (owners only): mail from those addresses or domains (bank, accountant, suppliers) is forwarded to the mailbox but **not saved** in the app | Needs the owners' list. |
| Attachments | Saved in R2 (like medical photos), up to ~25 MB each | Images preview in the thread. |
| Spam | Cloudflare's checks plus a "Not spam / Spam" button | Spam never matched to owners. |

## Requirements: SMS

| Need | Why |
|---|---|
| **Two-way number** | Receiving replies needs a real number (a long number or a dedicated mobile number). A **sender name** like "HannaPet" can only send: clients can't reply to it. Confirm which the provider gives you and whether replies reach you. |
| **Inbound webhook** | The provider must POST each incoming SMS to a URL we give it (and ideally sign it or let us set a secret). |
| **Delivery reports** | So the thread shows Sent / Delivered / Failed. |
| **Sender name registration** | If you also want messages to show "HannaPet" (send-only), it needs approval, which can take days. |
| **Cost per message** | Long messages split into parts (160 characters each, fewer with emoji); each part is charged. |
| **API** | Sending with an API key over HTTPS from Cloudflare. |

### Questions to ask Semaphore and Promotexter

1. Do you give us a number clients can **reply to**, and how do replies reach us (webhook to our URL)? Monthly fee for it?
2. Price per SMS part, for Smart, Globe and DITO; any minimum top-up or monthly minimum?
3. Delivery reports by webhook?
4. Sender name registration: needed, how long, and can replies still come back if we send with a name?
5. Can the webhook be signed or carry a secret token? Fixed IP addresses we can allow?
6. Message retention, data location, and a data processing agreement (Data Privacy Act).
7. Rate limits and uptime; is there a test (sandbox) mode?

## Security and the app's rules

- **The app has a rule: no new open routes.** Incoming email and SMS can't come through the app's
  login. Proposal: a **separate small Worker** ("inbox intake") that only *receives*:
  email via Email Routing (not a web address at all), and SMS via one webhook that checks the
  provider's secret. It writes to the app's database and can't read or show anything.
  The app itself stays fully behind login.
- Keys (Resend, SMS provider, webhook secret) are Cloudflare **Secrets**, never in git or chat.
- Nothing is hard-deleted; every send is logged with `audit()`.
- **Data Privacy Act:** messages are client data. The Privacy Notice must list the SMS provider.
  Marketing SMS only to people who agreed, with an opt-out ("Reply STOP"); appointment messages
  are fine without marketing consent.
- Never send to the old system's placeholder emails, or to an owner without a real email/mobile.

## Data (outline)

- `inbox_threads`: channel (email/sms), subject, owner_id (matched), status (open/done/spam),
  assigned_to, last_message_at, unread.
- `inbox_messages`: thread_id, direction (in/out), from, to, body_text, body_html (sanitised),
  provider ids (Message-ID, SMS id), delivery status, sent_by.
- `inbox_attachments`: message_id, R2 key, name, type, size.
- `inbox_notes`, `inbox_templates`.

## Phases

1. **Email in and out**: intake Worker (save + forward), Inbox list and thread, reply via Resend,
   owner matching, Done/Assign, notes, quick replies.
2. **SMS**: provider account and number, intake webhook, send from the thread and from an owner's page,
   delivery status.
3. **Reminders and broadcasts** (later): vaccine and follow-up reminders by email/SMS from the
   reminders the app already computes, with consent and opt-out.

## Still to decide

1. The **Private Senders** list: addresses or domains whose mail to hello@ should stay out of the app.
2. SMS provider (questions above), and whether reminders and promos go out under a sender name.
3. Reminders/promos: which ones first (vaccine due, follow-up, birthday?), and the consent wording
   (the website already records "Send me pet care tips and promos" as `marketing_consent`).
