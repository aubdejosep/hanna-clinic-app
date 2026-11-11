-- The old system started a medical record for every booking, with an automatic note listing the
-- services and products booked. A record with nothing else in it is "booking only": shown in the
-- history (with whether the visit happened), but it doesn't count as proof of a visit.
ALTER TABLE medical_records ADD COLUMN booking_only INTEGER NOT NULL DEFAULT 0;
