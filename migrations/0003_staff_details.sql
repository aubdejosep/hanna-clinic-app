-- Phase 1: staff details, as on the old system's Edit Staff panel.
--
-- schedule: JSON, one entry per day; a missing day or null is a day off.
--   {"mon": {"start": "09:30", "end": "20:00"}, "tue": null, ...}
-- Photos and signatures are small images (resized in the browser) kept in staff_images,
-- so lists don't load them. kind: 'photo' | 'signature'.

ALTER TABLE staff ADD COLUMN license_no TEXT;
ALTER TABLE staff ADD COLUMN license_expiry TEXT;
ALTER TABLE staff ADD COLUMN ptr_no TEXT;
ALTER TABLE staff ADD COLUMN s2_no TEXT;
ALTER TABLE staff ADD COLUMN street TEXT;
ALTER TABLE staff ADD COLUMN city TEXT;
ALTER TABLE staff ADD COLUMN province TEXT;
ALTER TABLE staff ADD COLUMN postal_code TEXT;
ALTER TABLE staff ADD COLUMN country TEXT NOT NULL DEFAULT 'Philippines';
ALTER TABLE staff ADD COLUMN max_leave_days INTEGER;
ALTER TABLE staff ADD COLUMN schedule TEXT NOT NULL DEFAULT '{}';

CREATE TABLE staff_images (
  staff_id    INTEGER NOT NULL REFERENCES staff (id),
  kind        TEXT NOT NULL CHECK (kind IN ('photo', 'signature')),
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL,        -- base64
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (staff_id, kind)
);
