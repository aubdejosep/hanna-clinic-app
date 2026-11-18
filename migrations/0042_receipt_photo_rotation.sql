-- Finances ▸ Receipts: how a receipt photo is turned (0, 90, 180 or 270 degrees), set in Type From Photos or the
-- photo panel, so it shows the right way up for everyone afterwards.
ALTER TABLE cash_lines ADD COLUMN photo_rotate INTEGER NOT NULL DEFAULT 0;
