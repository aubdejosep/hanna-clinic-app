-- Finances: balances (what clients still owe), payments against a balance, and the old system's
-- invoices (Finances ▸ Transactions ▸ Import from Old System).
--
-- A balance comes from: a visit checked out without a payment; a visit paid in part with the rest
-- marked as owed (payments.owed_cents); or an unpaid invoice from the old system. A later payment
-- against it is a payments row with kind 'balance'. Owners can clear one with a reason
-- (balance_clears), e.g. an old invoice that was settled but never updated.

ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'visit';   -- visit | sale | balance
ALTER TABLE payments ADD COLUMN owed_cents INTEGER NOT NULL DEFAULT 0; -- part of the total left owed (visit payments)
ALTER TABLE payments ADD COLUMN owner_id INTEGER;                     -- balance payments: whose
ALTER TABLE payments ADD COLUMN old_invoice_id INTEGER;               -- balance payments on an old invoice
UPDATE payments SET kind = 'sale' WHERE sale_id IS NOT NULL AND appointment_id IS NULL;
CREATE INDEX idx_payments_owed ON payments (appointment_id) WHERE owed_cents > 0;
CREATE INDEX idx_payments_balance ON payments (owner_id) WHERE kind = 'balance';
CREATE INDEX idx_appointments_unpaid ON appointments (owner_id) WHERE status = 'completed' AND payment_status = 'unpaid';

CREATE TABLE old_invoices (
  id              INTEGER PRIMARY KEY,
  branch_id       INTEGER NOT NULL DEFAULT 1,
  invoice_no      TEXT NOT NULL UNIQUE,          -- #INV2025A0001
  day             TEXT,                          -- Manila day; NULL when the export's date is unusable
  customer_name   TEXT,
  pet_name        TEXT,
  owner_id        INTEGER REFERENCES owners (id), -- matched by name when exactly one owner fits
  pet_id          INTEGER REFERENCES pets (id),
  status          TEXT NOT NULL,                 -- PAID | UNPAID (as the old system said)
  amount_cents    INTEGER NOT NULL DEFAULT 0,
  paid_cents      INTEGER NOT NULL DEFAULT 0,
  refunded_cents  INTEGER NOT NULL DEFAULT 0,
  method          TEXT,
  staff_names     TEXT,
  imported_at     TEXT NOT NULL,
  imported_by     TEXT
);
CREATE INDEX idx_old_invoices_owner ON old_invoices (owner_id);
CREATE INDEX idx_old_invoices_day ON old_invoices (day);

CREATE TABLE balance_clears (
  id              INTEGER PRIMARY KEY,
  appointment_id  INTEGER,
  old_invoice_id  INTEGER,
  owner_id        INTEGER NOT NULL,
  amount_cents    INTEGER NOT NULL,
  reason          TEXT NOT NULL,
  at              TEXT NOT NULL,
  staff_name      TEXT
);
CREATE INDEX idx_balance_clears_owner ON balance_clears (owner_id);
