-- The Clinic Profile page now matches the old system's: invoice tax rate, "CC business email on
-- all notifications", email brand colour, and an on/off switch for the kiosk agreement.
ALTER TABLE clinic ADD COLUMN tax_rate REAL NOT NULL DEFAULT 12;
ALTER TABLE clinic ADD COLUMN cc_business_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clinic ADD COLUMN email_brand_color TEXT NOT NULL DEFAULT '#0E7C78';
ALTER TABLE clinic ADD COLUMN kiosk_agreement_enabled INTEGER NOT NULL DEFAULT 1;
-- Phone Number + Secondary Phone, as on the old page (0916 415 8426 stays under Viber).
UPDATE clinic SET phones = '["0968 661 0021","(02) 8899-8194"]' WHERE id = 1;
