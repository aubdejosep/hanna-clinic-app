-- Finances ▸ Ledger: a receipt can be split into its items (one row each, shown under the receipt), and
-- "Discounts and Notes" becomes Discounts (a peso amount, added up) and Notes (text, the old note column).
-- Check on the page: items − discount should equal Total Per Receipt.

ALTER TABLE cash_lines ADD COLUMN discount_cents INTEGER;

CREATE TABLE cash_line_items (
  id            INTEGER PRIMARY KEY,
  line_id       INTEGER NOT NULL REFERENCES cash_lines (id),
  sort          INTEGER NOT NULL DEFAULT 0,
  item          TEXT,
  amount_cents  INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by    TEXT,
  updated_at    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT,
  deleted_by    TEXT
);
CREATE INDEX idx_cash_line_items_line ON cash_line_items (line_id, sort) WHERE deleted_at IS NULL;
