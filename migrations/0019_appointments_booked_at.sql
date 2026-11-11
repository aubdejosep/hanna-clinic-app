-- Appointments ▸ Recently Booked lists bookings by when they were made (newest first).
CREATE INDEX idx_appointments_created ON appointments (created_at);
