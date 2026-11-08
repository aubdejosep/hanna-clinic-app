-- Phase 0: the core of the clinic app — branches, staff, owners, pets, NFC tags and an audit log.
-- Appointments, services and medical records arrive in their own migrations (see docs/PLAN.md).
--
-- Conventions
--   * Times are ISO-8601 UTC strings (2026-11-08T06:30:00.000Z); calendar days are YYYY-MM-DD (Manila).
--   * Nothing is hard-deleted: rows get deleted_at / deleted_by and drop out of lists.
--   * Every row that belongs to a location carries branch_id, so a second branch is a settings change.
--   * review_flags is a JSON list of problems found on import (e.g. ["no_phone"]) for staff to clear.

CREATE TABLE branches (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  email       TEXT,
  color       TEXT NOT NULL DEFAULT '#12A8A3',
  is_main     INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO branches (id, name, address, phone, email, is_main) VALUES (
  1, 'Hanna Pet Wellness Center',
  '1266 Unit B Marian Townhouse, Pablo Ocampo St. cor. G. Del Pilar St., Malate, Manila 1004',
  '0968 661 0021', 'hannapetwellness@yahoo.com', 1
);

-- Who can log in. Login itself is Cloudflare Access (email PIN); this table decides what they see.
-- role: admin (everything) · vet · front_desk · groomer. title is the label shown on screen.
CREATE TABLE staff (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL DEFAULT '',
  title       TEXT,
  role        TEXT NOT NULL DEFAULT 'front_desk' CHECK (role IN ('admin', 'vet', 'front_desk', 'groomer')),
  phone       TEXT,
  branch_id   INTEGER NOT NULL DEFAULT 1 REFERENCES branches (id),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT
);

CREATE TABLE owners (
  id                  INTEGER PRIMARY KEY,
  customer_no         TEXT NOT NULL UNIQUE,            -- C000123; legacy numbers are kept as-is
  branch_id           INTEGER NOT NULL DEFAULT 1 REFERENCES branches (id),
  full_name           TEXT NOT NULL,
  additional_owner    TEXT,
  mobile              TEXT,                            -- +639XXXXXXXXX, or NULL when unknown
  mobile_raw          TEXT,                            -- what the old system had, when it wasn't a valid PH mobile
  email               TEXT COLLATE NOCASE,             -- real addresses only; the old placeholders are dropped
  messenger           TEXT,
  address             TEXT,
  vip                 INTEGER NOT NULL DEFAULT 0,
  reminders_opt_in    INTEGER NOT NULL DEFAULT 1,      -- appointment reminders (SMS/email)
  marketing_consent   INTEGER NOT NULL DEFAULT 0,      -- promos: only when the owner ticked the box
  notes               TEXT,
  source              TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('legacy', 'staff', 'website', 'walk_in')),
  legacy_added_on     TEXT,
  review_flags        TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT,
  deleted_at          TEXT,
  deleted_by          TEXT
);
CREATE INDEX idx_owners_mobile ON owners (mobile);
CREATE INDEX idx_owners_name ON owners (full_name COLLATE NOCASE);
CREATE INDEX idx_owners_email ON owners (email);

CREATE TABLE pets (
  id                INTEGER PRIMARY KEY,
  owner_id          INTEGER NOT NULL REFERENCES owners (id),
  name              TEXT NOT NULL,
  species           TEXT NOT NULL CHECK (species IN ('dog', 'cat', 'other')),
  breed             TEXT,                              -- standardised (e.g. "Shih Tzu")
  breed_raw         TEXT,                              -- as typed in the old system, when it differed
  sex               TEXT NOT NULL DEFAULT 'unknown' CHECK (sex IN ('male', 'female', 'unknown')),
  birthdate         TEXT,                              -- YYYY-MM-DD, NULL when unknown
  microchip         TEXT,
  color_markings    TEXT,
  allergies         TEXT,
  notes             TEXT,
  photo_key         TEXT,                              -- R2 object key (later phase)
  deceased_on       TEXT,
  legacy_added_on   TEXT,
  review_flags      TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT,
  deleted_at        TEXT,
  deleted_by        TEXT
);
CREATE INDEX idx_pets_owner ON pets (owner_id);
CREATE INDEX idx_pets_name ON pets (name COLLATE NOCASE);

-- NFC check-in: one tag (by its UID, as the bridge reports it) belongs to one pet at a time.
-- Retired tags stay with retired_at set so old scans can still be explained.
CREATE TABLE pet_tags (
  uid          TEXT PRIMARY KEY,
  pet_id       INTEGER NOT NULL REFERENCES pets (id),
  assigned_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  assigned_by  TEXT,
  retired_at   TEXT
);
CREATE INDEX idx_pet_tags_pet ON pet_tags (pet_id);

-- Who changed what. detail is JSON (before/after or a short description).
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  detail     TEXT
);
CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id);
