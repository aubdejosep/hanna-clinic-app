-- Phase 0b: the app's own login (email + password + "Remember me") replaces Cloudflare Access.
--
-- password_hash: "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>" (lib/password.js). Never the password.
-- sessions.token_hash: SHA-256 of the random token in the browser cookie, so a database copy
--   can't be used to log in. remember = 1 keeps the device logged in for 30 days (renewed on use);
--   otherwise the cookie ends with the browser and the session after 12 hours.

ALTER TABLE staff ADD COLUMN password_hash TEXT;
ALTER TABLE staff ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN locked_until TEXT;
ALTER TABLE staff ADD COLUMN last_login_at TEXT;

CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  staff_id      INTEGER NOT NULL REFERENCES staff (id),
  remember      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at    TEXT NOT NULL,
  user_agent    TEXT,
  revoked_at    TEXT
);
CREATE INDEX idx_sessions_staff ON sessions (staff_id);

-- Failed logins by network, so one place can't keep guessing across many accounts.
CREATE TABLE login_failures (
  id       INTEGER PRIMARY KEY,
  ip_hash  TEXT NOT NULL,
  at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_login_failures ON login_failures (ip_hash, at);

-- The two co-owners are "owner": everything, including staff accounts. Other roles are unchanged.
-- SQLite can't change a CHECK constraint in place, so the staff table is rebuilt with the new list.
CREATE TABLE staff_new (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL DEFAULT '',
  title          TEXT,
  role           TEXT NOT NULL DEFAULT 'front_desk' CHECK (role IN ('owner', 'admin', 'vet', 'front_desk', 'groomer')),
  phone          TEXT,
  branch_id      INTEGER NOT NULL DEFAULT 1 REFERENCES branches (id),
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT,
  password_hash  TEXT,
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  last_login_at  TEXT
);
INSERT INTO staff_new SELECT id, email, first_name, last_name, title, role, phone, branch_id, active, created_at,
  updated_at, password_hash, failed_logins, locked_until, last_login_at FROM staff;
DROP TABLE staff;
ALTER TABLE staff_new RENAME TO staff;
