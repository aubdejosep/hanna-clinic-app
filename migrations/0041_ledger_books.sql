-- Finances: two separate records ("books") per day. 'owner': Finances ▸ Ledger (typed by owners, Import File, Copy
-- from Staff). 'staff': Finances ▸ Receipts (typed by the front desk, with photos and their own summary). The Ledger's
-- Compare view lines them up by receipt number. Everything saved so far is the owners' Ledger.
ALTER TABLE cash_lines ADD COLUMN book TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE cash_expenses ADD COLUMN book TEXT NOT NULL DEFAULT 'owner';
CREATE INDEX idx_cash_lines_book_day ON cash_lines (branch_id, book, day);
CREATE INDEX idx_cash_expenses_book_day ON cash_expenses (branch_id, book, day);
