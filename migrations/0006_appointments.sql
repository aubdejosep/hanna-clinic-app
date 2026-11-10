-- Phase 2: appointments, with the old system's status steps and the NFC tap-in / tap-out loop.
--
-- A visit:  accepted ─tap in→ arrived ─Start→ started ─┬→ inpatient ─┐
--                                                       ├→ dispense ←┘
--                                                       └────────────┴─tap out→ completed
-- Grooming-only visits can go arrived ─tap out→ completed. Also: cancelled, no_show.
-- pending exists only on imported appointments (new bookings start as accepted).
-- A booking nobody tapped in for becomes no_show after its day (lib/appointments.js sweep()).
-- Imported appointments that were left open in the old system keep their status and have
-- legacy_unclosed = 1, so the sweep leaves them alone until the medical records import decides.

CREATE TABLE appointments (
  id                  INTEGER PRIMARY KEY,
  branch_id           INTEGER NOT NULL DEFAULT 1 REFERENCES branches (id),
  pet_id              INTEGER NOT NULL REFERENCES pets (id),
  owner_id            INTEGER NOT NULL REFERENCES owners (id),
  day                 TEXT NOT NULL,                     -- Manila YYYY-MM-DD
  time                TEXT NOT NULL,                     -- Manila HH:MM (24h)
  starts_at           TEXT NOT NULL,                     -- UTC ISO, for sorting across days
  status              TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN
                        ('pending', 'accepted', 'arrived', 'started', 'inpatient', 'dispense', 'completed', 'cancelled', 'no_show')),
  kind                TEXT NOT NULL DEFAULT 'booking' CHECK (kind IN ('booking', 'walk_in', 'follow_up')),
  source              TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'website', 'legacy', 'tag')),
  emergency           INTEGER NOT NULL DEFAULT 0,
  reason              TEXT,                              -- what the visit is for, as told when booking
  checked_in_at       TEXT,
  started_at          TEXT,
  admitted_at         TEXT,
  dispense_at         TEXT,
  checked_out_at      TEXT,
  cancelled_at        TEXT,
  cancel_reason       TEXT,
  rescheduled_from    INTEGER REFERENCES appointments (id),
  reschedule_reason   TEXT,
  booked_by_staff_id  INTEGER REFERENCES staff (id),
  booked_by_name      TEXT,                              -- shown as Booked By (staff name, "Website", or the old system's name)
  legacy_status       TEXT,                              -- the status the old system showed, for imported rows
  legacy_info         TEXT,                              -- the old system's note (e.g. "Missed Vaccination")
  legacy_unclosed     INTEGER NOT NULL DEFAULT 0,
  legacy_ref          INTEGER,                           -- the row number in the scraped list (import links reschedules with it)
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT,
  deleted_at          TEXT,
  deleted_by          TEXT
);
CREATE INDEX idx_appointments_day ON appointments (day, time);
CREATE INDEX idx_appointments_pet ON appointments (pet_id, day);
CREATE INDEX idx_appointments_owner ON appointments (owner_id);
CREATE INDEX idx_appointments_status ON appointments (status, day);
CREATE INDEX idx_appointments_from ON appointments (rescheduled_from);
CREATE INDEX idx_appointments_legacy ON appointments (legacy_ref);

-- Services & Products on the appointment (old: "Services & Products"). Names are copied in so the
-- record stays right even if the price list changes later.
CREATE TABLE appointment_items (
  id              INTEGER PRIMARY KEY,
  appointment_id  INTEGER NOT NULL REFERENCES appointments (id),
  service_id      INTEGER REFERENCES services (id),
  variation_id    INTEGER REFERENCES service_variations (id),
  name            TEXT NOT NULL,                        -- e.g. VACCINE
  detail          TEXT,                                 -- e.g. ANTI RABIES (variation or package)
  kind            TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service', 'product', 'custom')),
  qty             REAL NOT NULL DEFAULT 1,
  price_cents     INTEGER,
  added_by        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at      TEXT,
  deleted_by      TEXT
);
CREATE INDEX idx_appointment_items_appt ON appointment_items (appointment_id);

-- Staff Assignment: the vet(s) and staff on the appointment.
CREATE TABLE appointment_staff (
  appointment_id  INTEGER NOT NULL REFERENCES appointments (id),
  staff_id        INTEGER NOT NULL REFERENCES staff (id),
  PRIMARY KEY (appointment_id, staff_id)
);
CREATE INDEX idx_appointment_staff_staff ON appointment_staff (staff_id);

-- Staff Notes: clinic-internal, never shown to owners.
CREATE TABLE appointment_notes (
  id              INTEGER PRIMARY KEY,
  appointment_id  INTEGER NOT NULL REFERENCES appointments (id),
  staff_id        INTEGER REFERENCES staff (id),
  author          TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at      TEXT,
  deleted_by      TEXT
);
CREATE INDEX idx_appointment_notes_appt ON appointment_notes (appointment_id);

-- Every status change, with how it happened: button, tag (NFC tap), auto (end-of-day sweep),
-- booking or import. "Undo Last Step" goes back to the status before the latest change.
CREATE TABLE appointment_events (
  id              INTEGER PRIMARY KEY,
  appointment_id  INTEGER NOT NULL REFERENCES appointments (id),
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  via             TEXT NOT NULL CHECK (via IN ('button', 'tag', 'auto', 'booking', 'import')),
  actor           TEXT
);
CREATE INDEX idx_appointment_events_appt ON appointment_events (appointment_id, at);
