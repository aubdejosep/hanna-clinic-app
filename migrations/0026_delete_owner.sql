-- Delete Owner and All Records (owners and admins, on the owner's page): payments and quick sales of a
-- deleted owner are marked deleted too, so they leave every list and total. Nothing is erased.
ALTER TABLE payments ADD COLUMN deleted_at TEXT;
ALTER TABLE payments ADD COLUMN deleted_by TEXT;
ALTER TABLE sales ADD COLUMN deleted_at TEXT;
ALTER TABLE sales ADD COLUMN deleted_by TEXT;
