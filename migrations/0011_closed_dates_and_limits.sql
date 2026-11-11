-- Business Availability: closed dates and special hours, and limits on online bookings.
-- The website (/book) reads both, read only (see the website repo's docs/CLINIC-APP-HANDOVER.md):
-- keep these names and shapes, or tell the website session.

CREATE TABLE closed_dates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id   INTEGER NOT NULL DEFAULT 1,
  day         TEXT NOT NULL,          -- Manila calendar day, YYYY-MM-DD
  open        TEXT,                   -- HH:MM; open and close both NULL = closed all day
  close       TEXT,                   -- HH:MM; both set = open with these hours that day (e.g. a half day)
  reason      TEXT,                   -- shown to clients, e.g. "Christmas Day", "Staff training"
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT,
  deleted_at  TEXT,                   -- removed dates are soft-deleted, as everywhere in the app
  deleted_by  TEXT
);
CREATE INDEX idx_closed_dates_day ON closed_dates (branch_id, day);

-- Most pets bookable online per day and per window, e.g. {"day": 20, "morning": 10, "afternoon": 10}.
-- Missing, null or 0 = no limit. Counted by the website from its own bookings.
ALTER TABLE branches ADD COLUMN online_limits TEXT;
