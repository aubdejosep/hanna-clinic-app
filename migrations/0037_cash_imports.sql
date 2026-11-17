-- Finances ▸ Ledger ▸ Import File: each import is one row here, and the rows it added point back to it, so
-- Undo Import can take out exactly those rows (soft delete), wherever they are, and leave hand-typed rows alone.

CREATE TABLE cash_imports (
  id          INTEGER PRIMARY KEY,
  branch_id   INTEGER NOT NULL DEFAULT 1,
  file        TEXT,
  days        TEXT,                    -- JSON list of the Manila days it added rows to
  receipts    INTEGER NOT NULL DEFAULT 0,
  expenses    INTEGER NOT NULL DEFAULT 0,
  remits      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT,
  undone_at   TEXT,
  undone_by   TEXT
);

ALTER TABLE cash_lines ADD COLUMN import_id INTEGER REFERENCES cash_imports (id);
ALTER TABLE cash_expenses ADD COLUMN import_id INTEGER REFERENCES cash_imports (id);
ALTER TABLE cash_remits ADD COLUMN import_id INTEGER REFERENCES cash_imports (id);
CREATE INDEX idx_cash_lines_import ON cash_lines (import_id) WHERE import_id IS NOT NULL;
CREATE INDEX idx_cash_expenses_import ON cash_expenses (import_id) WHERE import_id IS NOT NULL;
CREATE INDEX idx_cash_remits_import ON cash_remits (import_id) WHERE import_id IS NOT NULL;
