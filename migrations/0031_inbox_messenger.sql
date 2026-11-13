-- Inbox: Facebook Page messages (Messenger) as a third channel. Plan: docs/MESSENGER-SETUP.md.
-- SQLite can't change a CHECK, so inbox_threads is rebuilt (same columns and data) with 'messenger'
-- allowed, plus external_id: the client's Page-scoped Messenger ID (PSID).
PRAGMA defer_foreign_keys = true;

CREATE TABLE inbox_threads_new (
  id               INTEGER PRIMARY KEY,
  branch_id        INTEGER NOT NULL DEFAULT 1,
  channel          TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'messenger')),
  subject          TEXT,
  contact_email    TEXT,
  contact_name     TEXT,
  owner_id         INTEGER REFERENCES owners (id),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'spam')),
  assigned_to      INTEGER REFERENCES staff (id),
  unread           INTEGER NOT NULL DEFAULT 1,
  message_count    INTEGER NOT NULL DEFAULT 0,
  last_message_at  TEXT,
  last_direction   TEXT,
  snippet          TEXT,
  restricted       INTEGER NOT NULL DEFAULT 0,
  restricted_by    TEXT,
  restricted_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT,
  deleted_at       TEXT,
  deleted_by       TEXT,
  external_id      TEXT,                    -- Messenger: the client's PSID
  last_in_at       TEXT                     -- Messenger: the client's last message (the 24-hour reply window)
);
INSERT INTO inbox_threads_new (id, branch_id, channel, subject, contact_email, contact_name, owner_id, status, assigned_to, unread,
  message_count, last_message_at, last_direction, snippet, restricted, restricted_by, restricted_at, created_at, updated_at, deleted_at, deleted_by)
SELECT id, branch_id, channel, subject, contact_email, contact_name, owner_id, status, assigned_to, unread,
  message_count, last_message_at, last_direction, snippet, restricted, restricted_by, restricted_at, created_at, updated_at, deleted_at, deleted_by
FROM inbox_threads;
DROP TABLE inbox_threads;
ALTER TABLE inbox_threads_new RENAME TO inbox_threads;
CREATE INDEX idx_inbox_threads_list ON inbox_threads (status, last_message_at);
CREATE INDEX idx_inbox_threads_contact ON inbox_threads (contact_email);
CREATE INDEX idx_inbox_threads_owner ON inbox_threads (owner_id);
CREATE INDEX idx_inbox_threads_external ON inbox_threads (channel, external_id);

PRAGMA defer_foreign_keys = false;
