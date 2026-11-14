-- Finances ▸ Daily Cash (owners and admins): the clinic's daily cash book, like the paper ledger. One line per
-- receipt (receipt number, client, pets, vet, how they paid, amount, vet commission), expenses paid from the
-- drawer (with a type), and the 1st (3 PM) and 2nd (end of day) remits. The page works out:
--   Total - Onlines - Expenses - 1st Remit = Cash On Hand, then checks it against the 2nd Remit.
-- Payments taken in the app show up as lines by themselves; editing one saves it here (payment_id).
-- Vet commission: generic meds x 10% + doctor's fee x 100% + surgery x 20% + lab tests x P50 (rates in
-- app_settings 'commission_rates'); commission_cents set = typed by hand instead.

CREATE TABLE cash_lines (
  id              INTEGER PRIMARY KEY,
  branch_id       INTEGER NOT NULL DEFAULT 1,
  day             TEXT NOT NULL,                 -- Manila day
  payment_id      INTEGER REFERENCES payments (id),
  receipt_no      TEXT,
  client_name     TEXT,
  pet_names       TEXT,
  vet_staff_id    INTEGER REFERENCES staff (id),
  vet_name        TEXT,
  method          TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'gcash', 'bank', 'maribank', 'card', 'qrph', 'maya', 'other')),
  amount_cents    INTEGER NOT NULL DEFAULT 0,
  meds_cents      INTEGER NOT NULL DEFAULT 0,    -- generic meds on this receipt
  doctor_cents    INTEGER NOT NULL DEFAULT 0,    -- doctor's fee
  surgery_cents   INTEGER NOT NULL DEFAULT 0,
  lab_tests       INTEGER NOT NULL DEFAULT 0,    -- how many lab tests
  commission_cents INTEGER,                      -- NULL: worked out from the above
  note            TEXT,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by      TEXT,
  updated_at      TEXT,
  updated_by      TEXT,
  deleted_at      TEXT,
  deleted_by      TEXT
);
CREATE INDEX idx_cash_lines_day ON cash_lines (branch_id, day);
CREATE UNIQUE INDEX idx_cash_lines_payment ON cash_lines (payment_id) WHERE payment_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE cash_expenses (
  id            INTEGER PRIMARY KEY,
  branch_id     INTEGER NOT NULL DEFAULT 1,
  day           TEXT NOT NULL,
  category      TEXT NOT NULL,                   -- Supplies, Food, Transport, Utilities, Repairs, Vet Commission, Other
  description   TEXT,
  amount_cents  INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by    TEXT,
  updated_at    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT,
  deleted_by    TEXT
);
CREATE INDEX idx_cash_expenses_day ON cash_expenses (branch_id, day);

CREATE TABLE cash_remits (
  id            INTEGER PRIMARY KEY,
  branch_id     INTEGER NOT NULL DEFAULT 1,
  day           TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('first', 'second')),   -- 1st Remit (3 PM), 2nd Remit (end of day)
  amount_cents  INTEGER NOT NULL,
  remitted_by   TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by    TEXT,
  updated_at    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT,
  deleted_by    TEXT
);
CREATE INDEX idx_cash_remits_day ON cash_remits (branch_id, day);
