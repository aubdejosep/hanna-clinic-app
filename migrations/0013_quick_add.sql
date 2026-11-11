-- Quick Add: a list of medicines and products to pick from (seeded from the old system's inventory
-- export: names and categories only, no stock), and a check that a visit's items are complete.

CREATE TABLE products (
  id          INTEGER PRIMARY KEY,
  branch_id   INTEGER NOT NULL DEFAULT 1 REFERENCES branches (id),
  name        TEXT NOT NULL,
  category    TEXT,
  source      TEXT NOT NULL DEFAULT 'inventory' CHECK (source IN ('inventory', 'typed')),  -- typed: first typed in on a visit
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT,
  deleted_at  TEXT,
  deleted_by  TEXT
);
CREATE UNIQUE INDEX idx_products_name ON products (branch_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;

ALTER TABLE appointment_items ADD COLUMN product_id INTEGER REFERENCES products (id);

-- Set when staff confirm the list at Check Out ("Anything else given?"). A tag tap-out leaves it
-- empty, so a Confirm Items reminder stays until someone checks the list.
ALTER TABLE appointments ADD COLUMN items_confirmed_at TEXT;
ALTER TABLE appointments ADD COLUMN items_confirmed_by TEXT;
UPDATE appointments SET items_confirmed_at = COALESCE(checked_out_at, updated_at, created_at) WHERE status = 'completed';
