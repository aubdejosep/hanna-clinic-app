-- Visit records written in the app. Every checked-out visit gets a medical record (source 'staff')
-- linked to its appointment: an automatic "Services and Products" entry and one vaccination entry per
-- vaccine given (auto = 'services' / 'vaccine:<item id>', kept in step with the visit), plus what the
-- vet writes (Note, Diagnosis, Prescription, Treatment Plan), with who wrote it and when.
ALTER TABLE medical_entries ADD COLUMN auto TEXT;
ALTER TABLE medical_entries ADD COLUMN created_by TEXT;
ALTER TABLE medical_entries ADD COLUMN staff_id INTEGER;
ALTER TABLE medical_entries ADD COLUMN updated_at TEXT;
ALTER TABLE medical_entries ADD COLUMN updated_by TEXT;
CREATE INDEX idx_medical_records_appt ON medical_records (appointment_id) WHERE appointment_id IS NOT NULL;
