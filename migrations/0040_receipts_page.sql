-- Finances ▸ Receipts (every staff member): the same receipt rows as the Ledger, typed by the front desk, each
-- with its photo (R2, PHOTOS bucket, key receipts/...) and how it was paid; and the front desk's own summary,
-- typed by hand like the paper slip, checked on screen against the rows. Expenses are the Ledger's expenses.

ALTER TABLE cash_lines ADD COLUMN paid_with TEXT;      -- cash, gcash, bank, maribank, card, qrph, or none (not counted)
ALTER TABLE cash_lines ADD COLUMN photo_key TEXT;
ALTER TABLE cash_lines ADD COLUMN photo_type TEXT;
CREATE INDEX idx_cash_lines_receipt_no ON cash_lines (receipt_no) WHERE receipt_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_cash_lines_receipt_qr ON cash_lines (receipt_qr) WHERE receipt_qr IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE cash_summaries (
  id                  INTEGER PRIMARY KEY,
  branch_id           INTEGER NOT NULL DEFAULT 1,
  day                 TEXT NOT NULL,
  income_cents        INTEGER,
  expenses_cents      INTEGER,
  online_cents        INTEGER,
  first_remit_cents   INTEGER,
  cash_on_hand_cents  INTEGER,
  online_list         TEXT,           -- JSON [{name, amountCents, code}]
  grooming_list       TEXT,           -- JSON [{name, amountCents}]
  note                TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by          TEXT,
  updated_at          TEXT,
  updated_by          TEXT,
  deleted_at          TEXT,
  deleted_by          TEXT
);
CREATE UNIQUE INDEX idx_cash_summaries_day ON cash_summaries (branch_id, day) WHERE deleted_at IS NULL;
