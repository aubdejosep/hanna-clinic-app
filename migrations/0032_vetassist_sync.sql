-- VetAssist sync (Clinic Operations ▸ Import from VetAssist): repeat imports that add new rows and update
-- changed ones (VetAssist wins until go-live), keyed on what the old system gives us. Nothing is deleted.

-- Appointments have no ID in the old list: the scraper's row key (pet|owner|date|time|booked by|n).
-- Rows imported before this keep a NULL key until the first sync matches them by pet, day and time.
ALTER TABLE appointments ADD COLUMN legacy_key TEXT;
CREATE INDEX idx_appointments_legacy_key ON appointments (legacy_key) WHERE legacy_key IS NOT NULL;

-- Medical records are matched by the old record ID.
CREATE INDEX idx_medical_records_legacy_id ON medical_records (legacy_record_id) WHERE legacy_record_id IS NOT NULL;

-- One row per import run: what was imported, when, by whom, and the counts (shown on the import page).
CREATE TABLE vetassist_syncs (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,              -- owners_pets, deceased, appointments, records, photos, services, products
  file_name   TEXT,
  counts      TEXT,                       -- JSON {new, updated, same, review}
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  staff_id    INTEGER,
  staff_name  TEXT
);
CREATE INDEX idx_vetassist_syncs_kind ON vetassist_syncs (kind, started_at);
