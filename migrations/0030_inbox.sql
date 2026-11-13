-- Inbox (phase 1: email to and from hello@hannapetwellnesscenter.com). Plan: docs/INBOX-PLAN.md.
-- Mail to hello@ reaches the email Worker (workers/inbox-intake), which forwards it to the clinic's
-- private mailbox first and then saves it here. Replies are sent from the app through Resend.

CREATE TABLE inbox_threads (
  id               INTEGER PRIMARY KEY,
  branch_id        INTEGER NOT NULL DEFAULT 1,
  channel          TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  subject          TEXT,
  contact_email    TEXT,                    -- lower case
  contact_name     TEXT,
  owner_id         INTEGER REFERENCES owners (id),   -- matched by email, or linked by staff
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'spam')),
  assigned_to      INTEGER REFERENCES staff (id),
  unread           INTEGER NOT NULL DEFAULT 1,
  message_count    INTEGER NOT NULL DEFAULT 0,
  last_message_at  TEXT,
  last_direction   TEXT,
  snippet          TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT,
  deleted_at       TEXT,
  deleted_by       TEXT
);
CREATE INDEX idx_inbox_threads_list ON inbox_threads (status, last_message_at);
CREATE INDEX idx_inbox_threads_contact ON inbox_threads (contact_email);
CREATE INDEX idx_inbox_threads_owner ON inbox_threads (owner_id);

CREATE TABLE inbox_messages (
  id            INTEGER PRIMARY KEY,
  thread_id     INTEGER NOT NULL REFERENCES inbox_threads (id),
  direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  message_id    TEXT,                       -- the email's Message-ID, for threading
  in_reply_to   TEXT,
  references_h  TEXT,
  from_email    TEXT,
  from_name     TEXT,
  to_emails     TEXT,
  cc_emails     TEXT,
  subject       TEXT,
  text_body     TEXT,
  html_body     TEXT,                       -- cleaned (lib/html.js)
  status        TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'sent', 'failed')),
  error         TEXT,
  provider_id   TEXT,                       -- Resend's id for sent mail
  sent_by       TEXT,
  staff_id      INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_inbox_messages_thread ON inbox_messages (thread_id, created_at);
CREATE INDEX idx_inbox_messages_mid ON inbox_messages (message_id);

CREATE TABLE inbox_attachments (
  id            INTEGER PRIMARY KEY,
  message_id    INTEGER NOT NULL REFERENCES inbox_messages (id),
  r2_key        TEXT NOT NULL,
  filename      TEXT,
  content_type  TEXT,
  bytes         INTEGER
);
CREATE INDEX idx_inbox_attachments_message ON inbox_attachments (message_id);

-- Staff-only notes on a conversation (never sent).
CREATE TABLE inbox_notes (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES inbox_threads (id),
  body        TEXT NOT NULL,
  staff_id    INTEGER,
  author      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT,
  deleted_by  TEXT
);
CREATE INDEX idx_inbox_notes_thread ON inbox_notes (thread_id);

-- Private Senders (owners and admins): mail to hello@ from these addresses or @domains is forwarded to
-- the private mailbox but never saved in the app.
CREATE TABLE inbox_private_senders (
  id          INTEGER PRIMARY KEY,
  pattern     TEXT NOT NULL,                -- name@example.com, or @example.com for a whole domain
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT,
  deleted_at  TEXT,
  deleted_by  TEXT
);

-- Quick replies (owners and admins keep them; everyone uses them).
CREATE TABLE inbox_templates (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT,
  updated_at  TEXT,
  deleted_at  TEXT,
  deleted_by  TEXT
);
INSERT INTO inbox_templates (title, body, sort, created_by) VALUES
  ('How to Book', 'You can book online at hannapetwellnesscenter.com/book and just come in on the day you pick. You can also message us on Messenger (m.me/HannaPetWellness) or call (02) 8899-8194, 0968 661 0021 or 0916 415 8426.', 1, 'Starter'),
  ('Directions', 'We''re at 1266 Unit B Marian Townhouse, Pablo Ocampo St. cor. G. Del Pilar St., Malate, Manila 1004. Directions: https://www.google.com/maps/dir/?api=1&destination=14.5659711,121.0021612', 2, 'Starter'),
  ('Opening Hours', 'We''re open Monday to Thursday, 9 AM to 7 PM, and Friday to Sunday, 8 AM to 8 PM. Holiday hours may differ.', 3, 'Starter'),
  ('Send a Photo', 'Thank you for reaching out. Could you send us a clear photo of the area and tell us how long it''s been like this? The vet will have a look.', 4, 'Starter');
