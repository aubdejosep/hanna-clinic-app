-- From the staff ID cards: birthday and emergency contact (owners and admins only, like all staff details).
ALTER TABLE staff ADD COLUMN birthday TEXT;          -- YYYY-MM-DD
ALTER TABLE staff ADD COLUMN emergency_name TEXT;
ALTER TABLE staff ADD COLUMN emergency_phone TEXT;   -- +639XXXXXXXXX
