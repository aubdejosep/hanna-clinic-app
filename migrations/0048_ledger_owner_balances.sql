-- Link daily cash ledger rows (Staff Receipts & Owner Ledger) to a Masterlist owner when chosen
-- from autocomplete, and allow recording payments / clears against ledger balances in Finances ▸ Balances.
ALTER TABLE cash_lines ADD COLUMN owner_id INTEGER REFERENCES owners (id);
ALTER TABLE payments ADD COLUMN cash_line_id INTEGER;
ALTER TABLE balance_clears ADD COLUMN cash_line_id INTEGER;

CREATE INDEX idx_cash_lines_balance_owner ON cash_lines (owner_id) WHERE balance_cents > 0 AND owner_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payments_cash_line ON payments (cash_line_id) WHERE cash_line_id IS NOT NULL;
CREATE INDEX idx_balance_clears_cash_line ON balance_clears (cash_line_id) WHERE cash_line_id IS NOT NULL;
