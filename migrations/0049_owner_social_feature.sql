-- Facebook feature consent synced from website bookings (bookings.feature) and editable by staff.
-- Keep all 4 states distinct: 'yes', 'ask', 'no', or NULL (not asked).
ALTER TABLE owners ADD COLUMN social_feature TEXT CHECK (social_feature IN ('yes', 'ask', 'no'));
ALTER TABLE owners ADD COLUMN social_feature_at TEXT;
