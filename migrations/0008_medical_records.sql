-- Phase 3: the medical history imported from the old system (read-only for now).
--
-- A medical record is one PDF from the old system: a visit (it has an old appointment number) or a
-- standalone record. Each record holds entries: Note, Vaccination, Diagnosis, Treatment Plan.
-- The old system's automatic "booked" notes are not imported; the bookings are in appointments.

CREATE TABLE medical_records (
  id                     INTEGER PRIMARY KEY,
  branch_id              INTEGER NOT NULL DEFAULT 1 REFERENCES branches (id),
  pet_id                 INTEGER NOT NULL REFERENCES pets (id),
  owner_id               INTEGER NOT NULL REFERENCES owners (id),
  day                    TEXT NOT NULL,                 -- Manila YYYY-MM-DD (the record or visit date)
  kind                   TEXT NOT NULL DEFAULT 'record' CHECK (kind IN ('visit', 'record')),
  appointment_id         INTEGER REFERENCES appointments (id),
  source                 TEXT NOT NULL DEFAULT 'legacy' CHECK (source IN ('legacy', 'staff')),
  legacy_record_id       TEXT,
  legacy_appointment_no  TEXT,                          -- e.g. 2026A3484
  legacy_ref             INTEGER,                       -- line number in the scraped file (import uses it)
  legacy_file            TEXT,                          -- "<zip>/<pdf>" on the clinic PC, for the photo upload
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at             TEXT,
  deleted_by             TEXT
);
CREATE INDEX idx_medical_records_pet ON medical_records (pet_id, day);
CREATE INDEX idx_medical_records_day ON medical_records (day);
CREATE INDEX idx_medical_records_legacy ON medical_records (legacy_ref);

CREATE TABLE medical_entries (
  id            INTEGER PRIMARY KEY,
  record_id     INTEGER NOT NULL REFERENCES medical_records (id),
  pet_id        INTEGER NOT NULL REFERENCES pets (id),
  day           TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('note', 'vaccination', 'diagnosis', 'treatment_plan', 'prescription', 'other')),
  title         TEXT,
  description   TEXT,
  items         TEXT NOT NULL DEFAULT '[]',   -- JSON: [{kind, name, detail, qty, notes}]
  details       TEXT,                         -- JSON: treatment plan dates, objectives, assigned staff…
  image_count   INTEGER NOT NULL DEFAULT 0,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at    TEXT,
  deleted_by    TEXT
);
CREATE INDEX idx_medical_entries_record ON medical_entries (record_id, sort);
CREATE INDEX idx_medical_entries_pet ON medical_entries (pet_id, type, day);
