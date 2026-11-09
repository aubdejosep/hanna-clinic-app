-- Phase 1: clinic profile, opening hours, kiosk settings, and the services price list.

-- One row: the clinic's business details (shared by every branch).
-- phones: JSON list of strings. social: JSON object (facebook, instagram, tiktok, x, viber, whatsapp, messenger).
CREATE TABLE clinic (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  name             TEXT NOT NULL,
  tagline          TEXT,
  descriptor       TEXT,
  email            TEXT,
  phones           TEXT NOT NULL DEFAULT '[]',
  website          TEXT,
  about            TEXT,
  social           TEXT NOT NULL DEFAULT '{}',
  kiosk_enabled    INTEGER NOT NULL DEFAULT 1,
  kiosk_agreement  TEXT,
  updated_at       TEXT,
  updated_by       TEXT
);

-- Filled in from hannapetwellnesscenter.com (the website's CLAUDE.md "Clinic facts").
INSERT INTO clinic (id, name, tagline, descriptor, email, phones, website, about, social) VALUES (
  1,
  'Hanna Pet Wellness Center',
  'We keep your pets healthy so they keep you happy.',
  'Veterinary and Grooming Services',
  'hannapetwellness@yahoo.com',
  '["(02) 8899-8194","0968 661 0021","0916 415 8426"]',
  'https://hannapetwellnesscenter.com',
  'A veterinary and grooming clinic in Malate, Manila, for dogs and cats.',
  '{"facebook":"https://www.facebook.com/HannaPetWellness","messenger":"https://m.me/HannaPetWellness","viber":"0916 415 8426"}'
);

-- Opening hours per branch. JSON, one entry per day; null = closed.
--   {"mon": {"open": "09:00", "close": "19:00", "breaks": [{"start": "12:00", "end": "13:00"}]}, ...}
ALTER TABLE branches ADD COLUMN hours TEXT NOT NULL DEFAULT '{}';
UPDATE branches SET
  address = '1266 Unit B Marian Townhouse, Pablo Ocampo St. cor. G. Del Pilar St., Malate, Manila 1004',
  phone = '0968 661 0021',
  hours = '{"mon":{"open":"09:00","close":"19:00","breaks":[]},"tue":{"open":"09:00","close":"19:00","breaks":[]},"wed":{"open":"09:00","close":"19:00","breaks":[]},"thu":{"open":"09:00","close":"19:00","breaks":[]},"fri":{"open":"08:00","close":"20:00","breaks":[]},"sat":{"open":"08:00","close":"20:00","breaks":[]},"sun":{"open":"08:00","close":"20:00","breaks":[]}}'
WHERE id = 1;

-- Services price list. Prices are whole centavos (250000 = ₱2,500.00) so sums never round oddly.
CREATE TABLE service_categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE services (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  price_cents      INTEGER NOT NULL DEFAULT 0,
  category_id      INTEGER REFERENCES service_categories (id),
  active           INTEGER NOT NULL DEFAULT 1,
  featured_online  INTEGER NOT NULL DEFAULT 0,   -- shown on the website booking form
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT,
  deleted_at       TEXT,
  deleted_by       TEXT
);
CREATE INDEX idx_services_category ON services (category_id);

-- e.g. DOG DENTAL: "1–3 kg" ₱4,000, "3–5 kg" ₱4,500. A service with variations is priced by variation.
CREATE TABLE service_variations (
  id           INTEGER PRIMARY KEY,
  service_id   INTEGER NOT NULL REFERENCES services (id),
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_variations_service ON service_variations (service_id);
