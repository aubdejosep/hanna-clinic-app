-- Photos on medical record entries (scanned paper records, prescriptions, vaccine cards…). The files
-- live in the private R2 bucket hanna-clinic-photos (binding PHOTOS); this table says which entry each
-- one belongs to. Served only to logged-in staff through /api/photos/:id.
CREATE TABLE medical_images (
  id          INTEGER PRIMARY KEY,
  record_id   INTEGER NOT NULL REFERENCES medical_records (id),
  entry_id    INTEGER REFERENCES medical_entries (id),
  pet_id      INTEGER NOT NULL REFERENCES pets (id),
  key         TEXT NOT NULL UNIQUE,      -- object key in R2, e.g. legacy/0001/MedicalRecord-…-1.jpg
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes       INTEGER,
  width       INTEGER,
  height      INTEGER,
  sort        INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'legacy' CHECK (source IN ('legacy', 'staff')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT,
  deleted_at  TEXT,
  deleted_by  TEXT
);
CREATE INDEX idx_medical_images_entry ON medical_images (entry_id);
CREATE INDEX idx_medical_images_record ON medical_images (record_id);
