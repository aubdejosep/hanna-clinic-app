-- Phase 4: what the clinic board and the reminders bell need.
--   * Weight: the pet's latest weight, and the weight taken at each visit (medicine doses go by weight).
--   * Follow-up: the vet ticks "Needs a Follow-Up" on a visit; the bell reminds until one is booked.
--   * Reminder dismissals: "Not Needed" on a reminder hides it for everyone.

ALTER TABLE pets ADD COLUMN weight_kg REAL;
ALTER TABLE pets ADD COLUMN weight_on TEXT;            -- Manila day the weight was taken
ALTER TABLE appointments ADD COLUMN weight_kg REAL;
ALTER TABLE appointments ADD COLUMN follow_up_days INTEGER;
ALTER TABLE appointments ADD COLUMN follow_up_reason TEXT;
ALTER TABLE appointments ADD COLUMN follow_up_by TEXT;

CREATE TABLE reminder_dismissals (
  key           TEXT PRIMARY KEY,                       -- e.g. "follow_up:123", "pet_info:45"
  dismissed_by  TEXT NOT NULL,
  reason        TEXT,
  at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
