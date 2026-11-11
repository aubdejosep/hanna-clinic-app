-- Fewer database reads (Cloudflare's free plan allows 5 million rows read a day).
-- Indexes so the reminders and lists read only the rows they need, not whole tables.

-- Pets and owners added in the app (not imported), for "missing details" reminders.
CREATE INDEX idx_pets_app_added ON pets (created_at) WHERE legacy_added_on IS NULL;
CREATE INDEX idx_owners_source ON owners (source, created_at);
-- Appointment tab counts, read from the index alone.
CREATE INDEX idx_appointments_tabs ON appointments (deleted_at, status, emergency, legacy_unclosed);
