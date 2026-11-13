# Facebook Page messages (Messenger) in the Inbox: setup

Messages sent to the **Hanna Pet Wellness Center Facebook Page** come into the app's Inbox as **Messenger**
conversations, and staff can reply from the app. Meta Business Suite and the Pages app keep working as before:
replies sent there show up in the app too.

**How it works:** Meta sends each Page message to the inbox intake Worker at
`https://hooks.hannapetwellnesscenter.com/meta`. The Worker refuses anything that isn't signed by Meta (your app secret),
saves the message (photos and files are copied into the clinic's storage, because Meta's links expire), and nothing
else. The clinic app itself stays behind its login. Code: `lib/messenger.js`, `workers/inbox-intake/src/index.js`.

**Meta's rules:**
- The clinic can reply **within 24 hours of the client's last message**. After that the reply box closes and says why
  (call or email them instead). With Meta's **Human Agent** permission (applied for separately, step 6), replies are
  allowed for 7 days.
- Messenger doesn't share a client's mobile or email: link the conversation to the owner with **Link to Owner**.
- No reminders or promos by Messenger (Meta doesn't allow them outside the 24 hours); those go by email or SMS.

Allow about an hour for steps 2 to 5, plus Meta's waiting time for steps 1 and 6.

## 1. Business Verification (start now: it's the slowest)

In **Meta Business Suite** (business.facebook.com) for the business that owns the Hanna Pet Page:
**Settings ▸ Business info** (or **Security Center**) **▸ Start verification**. Have ready: the clinic's registered name
and address exactly as on DTI/SEC or BIR papers, a business phone, the website, and a document photo or PDF.
It usually takes a few days to two weeks. You can do steps 2 to 5 while you wait.

## 2. Update the database and the Worker (PowerShell, from the `hanna-clinic-app` folder)

```
git pull
npm run db:migrate:remote
cd workers\inbox-intake
npx wrangler deploy
cd ..\..
```

The deploy also creates **hooks.hannapetwellnesscenter.com**. Open `https://hooks.hannapetwellnesscenter.com/meta`
in a browser: a blank page or "403" is right (it only answers Meta).

## 3. Create the Meta app

1. Go to **developers.facebook.com ▸ My Apps ▸ Create App**. Name it "Hanna Clinic App". Choose the use case for
   **Messenger / engaging with customers** (if it isn't listed, choose **Other ▸ Business**), and connect it to the
   clinic's business portfolio.
2. In the app: **Add product ▸ Messenger ▸ Set up**. Under **Messenger API Settings ▸ Generate access tokens**,
   **Connect** the Hanna Pet Wellness Center Page, then **Generate** a token for it. Copy it somewhere safe for a moment
   (this is the **Page token**). Don't paste it in chat.
3. **App settings ▸ Basic ▸ App secret ▸ Show**: this is the **App secret**.
4. The **Page ID** is shown next to the Page in Messenger API Settings (or Page ▸ About ▸ Page transparency).
5. Make up a **verify token**: any long phrase, e.g. three random words and a number. It's only used once, in step 4.

## 4. Save the keys as Cloudflare secrets

From `hanna-clinic-app\workers\inbox-intake`, run each line and paste the value when asked:

```
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put META_PAGE_TOKEN
npx wrangler secret put META_PAGE_ID
```

Then the app (for replies), from the `hanna-clinic-app` folder:

```
npx wrangler pages secret put META_PAGE_TOKEN --project-name hanna-clinic-app
```

and in Cloudflare **Workers & Pages ▸ hanna-clinic-app ▸ Deployments ▸ ⋯ ▸ Retry deployment** on the latest one.

## 5. Connect the webhook and test

1. In the Meta app: **Messenger API Settings ▸ Configure webhooks**. Callback URL:
   `https://hooks.hannapetwellnesscenter.com/meta`. Verify token: the phrase from step 3.5. **Verify and save.**
2. Under **Webhooks** for the Page, **Add subscriptions**: tick **messages**, **message_echoes** and
   **messaging_postbacks**. Save.
3. Test: from your **personal** Facebook account (it must have a role on the Meta app, which as its creator it does),
   message the Page. Within a few seconds it should be in the app's Inbox as **Messenger**. Reply from the app and check
   it arrives in Messenger. Reply once from Meta Business Suite too: it should appear in the app's conversation.

Until step 6 is approved, **only people with a role on the Meta app** (admins, developers, testers) come through.
Clients' messages still reach Business Suite as usual.

**If nothing arrives:** Cloudflare ▸ Workers & Pages ▸ hanna-inbox-intake ▸ Logs. `messenger {"threadId":…}` means it
was saved. No line at all: check the webhook subscription (step 5.2) and that the secrets were saved (step 4).

## 6. Meta App Review (to receive every client's messages)

In the Meta app: **App Review ▸ Permissions and Features**, request **Advanced Access** for **pages_messaging**
(and **pages_manage_metadata** and **pages_show_list** if it asks). Meta wants:
- a **Privacy Policy URL**: the website needs a public privacy page for this (to be added: ask Claude);
- a short **screen recording**: a message arriving in the Inbox, a reply sent from the app, and the reply in Messenger;
- a one-line use: "Clinic staff read and answer messages that pet owners send to our Facebook Page."

Optional, after that: request **Human Agent** to reply for up to 7 days. Once approved, set
`npx wrangler pages secret put META_HUMAN_AGENT --project-name hanna-clinic-app` to `1` and retry the deployment.

**Privacy Notice:** add Messenger to what the clinic keeps ("messages you send to our Facebook Page are kept in the
clinic's system so staff can answer them") on the website's privacy page and Privacy Notice.

## To turn it off

In the Meta app, remove the Page's webhook subscription. Messages then stay only in Business Suite, as before.
Nothing already saved in the app is deleted.
