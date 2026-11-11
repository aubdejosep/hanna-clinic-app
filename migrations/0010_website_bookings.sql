-- Phase 5: bookings made on hannapetwellnesscenter.com/book land in Appointments.
-- The app reads the website's database (binding LEADS, hanna-leads) and adds each new booking,
-- one appointment per pet. external_ref ("BK-XXXXXX#0") stops a booking being added twice.

ALTER TABLE appointments ADD COLUMN external_ref TEXT;
CREATE INDEX idx_appointments_external ON appointments (external_ref);

-- Small key/value store for background jobs (e.g. when the website was last checked).
CREATE TABLE sync_state (
  key    TEXT PRIMARY KEY,
  value  TEXT,
  at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
