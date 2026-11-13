-- Finances ▸ Transactions ▸ Payments: payments exported from the old system ("payment transactions").
-- Matched to the imported old invoice by invoice number, and to an owner by name. The export rounds
-- big amounts ("₱23.7K"); those are worked out from the invoice where possible (amount_note says so).
CREATE TABLE old_payments (
  id              INTEGER PRIMARY KEY,
  branch_id       INTEGER NOT NULL DEFAULT 1,
  import_key      TEXT NOT NULL UNIQUE,         -- invoice no | date | amount as exported | nth such row
  invoice_no      TEXT,
  old_invoice_id  INTEGER REFERENCES old_invoices (id),
  txn_no          TEXT,
  reference       TEXT,
  customer_name   TEXT,
  pet_name        TEXT,
  owner_id        INTEGER REFERENCES owners (id),
  method          TEXT,
  amount_cents    INTEGER NOT NULL,
  amount_note     TEXT,
  day             TEXT,
  time            TEXT,
  reason          TEXT,
  creator         TEXT,
  imported_at     TEXT NOT NULL,
  imported_by     TEXT
);
CREATE INDEX idx_old_payments_day ON old_payments (day);
CREATE INDEX idx_old_payments_invoice ON old_payments (old_invoice_id);
