-- Smart Prescription ▸ Medication List: the clinic's drug reference, as in the old system. A medication has a
-- formatted description, an optional image (R2: medications/), dosages (amount, unit, type e.g. 0.6 ml Per Kg)
-- and optional variations (other forms or strengths), each with its own dosages.
CREATE TABLE medications (
  id                INTEGER PRIMARY KEY,
  branch_id         INTEGER NOT NULL DEFAULT 1,
  name              TEXT NOT NULL,
  description_html  TEXT,                 -- sanitised (lib/html.js)
  description_text  TEXT,                 -- plain copy for the list and search
  image_key         TEXT,
  image_type        TEXT,
  legacy_key        TEXT UNIQUE,          -- lower-case name from the old system, for re-imports
  legacy_added_on   TEXT,                 -- the old system's Date Added (Manila day)
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by        TEXT,
  updated_at        TEXT,
  updated_by        TEXT,
  deleted_at        TEXT,
  deleted_by        TEXT
);
CREATE INDEX idx_medications_name ON medications (name COLLATE NOCASE);

CREATE TABLE medication_variations (
  id             INTEGER PRIMARY KEY,
  medication_id  INTEGER NOT NULL REFERENCES medications (id),
  name           TEXT NOT NULL,
  details        TEXT,
  sort           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_medication_variations ON medication_variations (medication_id);

CREATE TABLE medication_dosages (
  id             INTEGER PRIMARY KEY,
  medication_id  INTEGER NOT NULL REFERENCES medications (id),
  variation_id   INTEGER REFERENCES medication_variations (id),   -- NULL: the medication's general dosage
  amount         TEXT NOT NULL,          -- "0.6", or a range like "1-2"
  unit           TEXT NOT NULL,          -- ml, mg, tablet…
  type           TEXT NOT NULL,          -- Per Kg, Per Animal…
  sort           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_medication_dosages ON medication_dosages (medication_id);
