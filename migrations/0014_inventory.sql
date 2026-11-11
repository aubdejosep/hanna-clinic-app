-- Inventory that lives inside the visits: stock on hand per product (in the smallest unit given:
-- tablet, ml, vial, piece…), every change in stock_movements (who, when, why, linked to the visit,
-- sale or count), payments, over-the-counter sales, and stock counts (the first one is the baseline).
-- A visit's medicines, and the stock its services use, come off stock only once the visit is both
-- paid and checked out.

ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece';
ALTER TABLE products ADD COLUMN pack_name TEXT;          -- what it's bought in, e.g. box, bottle
ALTER TABLE products ADD COLUMN pack_size REAL;          -- units in one pack, e.g. 100 tablets a box
ALTER TABLE products ADD COLUMN price_cents INTEGER;     -- selling price per unit
ALTER TABLE products ADD COLUMN cost_cents INTEGER;      -- cost per unit
ALTER TABLE products ADD COLUMN reorder_level REAL;      -- low-stock alert at or below this
ALTER TABLE products ADD COLUMN on_hand REAL NOT NULL DEFAULT 0;  -- kept equal to the sum of its movements
ALTER TABLE products ADD COLUMN counted_at TEXT;         -- last stock count that included it
ALTER TABLE products ADD COLUMN updated_at TEXT;

-- Stock by delivery, for expiry dates. Deductions use the earliest expiry first.
CREATE TABLE stock_batches (
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products (id),
  batch_no      TEXT,
  expiry        TEXT,                    -- YYYY-MM-DD
  received_qty  REAL NOT NULL,
  remaining     REAL NOT NULL,
  unit_cost_cents INTEGER,
  supplier      TEXT,
  received_on   TEXT NOT NULL,           -- Manila day
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by    TEXT
);
CREATE INDEX idx_stock_batches_product ON stock_batches (product_id, remaining);
CREATE INDEX idx_stock_batches_expiry ON stock_batches (expiry) WHERE remaining > 0;

-- Every change to stock, never edited or deleted. A mistake is fixed by a new movement.
CREATE TABLE stock_movements (
  id              INTEGER PRIMARY KEY,
  branch_id       INTEGER NOT NULL DEFAULT 1,
  product_id      INTEGER NOT NULL REFERENCES products (id),
  at              TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('count', 'receive', 'visit', 'sale', 'adjust', 'reversal')),
  qty             REAL NOT NULL,         -- + in, - out, in units
  balance         REAL NOT NULL,         -- on hand after this movement
  reason          TEXT,                  -- adjustments: Expired, Damaged, Used in Clinic, Lost, Found…
  appointment_id  INTEGER REFERENCES appointments (id),
  item_id         INTEGER REFERENCES appointment_items (id),
  sale_id         INTEGER,
  count_id        INTEGER,
  batch_id        INTEGER,
  unit_cost_cents INTEGER,
  staff_id        INTEGER,
  staff_name      TEXT
);
CREATE INDEX idx_stock_movements_product ON stock_movements (product_id, at);
CREATE INDEX idx_stock_movements_at ON stock_movements (at);
CREATE INDEX idx_stock_movements_appt ON stock_movements (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX idx_stock_movements_sale ON stock_movements (sale_id) WHERE sale_id IS NOT NULL;

-- What a service uses from stock, set once in Services, e.g. VACCINE · ANTI RABIES uses 1 vial.
-- variation_id NULL = the service itself, and every size that has no links of its own.
CREATE TABLE service_stock (
  id            INTEGER PRIMARY KEY,
  service_id    INTEGER NOT NULL REFERENCES services (id),
  variation_id  INTEGER REFERENCES service_variations (id),
  product_id    INTEGER NOT NULL REFERENCES products (id),
  qty           REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by    TEXT,
  deleted_at    TEXT,
  deleted_by    TEXT
);
CREATE UNIQUE INDEX idx_service_stock ON service_stock (service_id, COALESCE(variation_id, 0), product_id) WHERE deleted_at IS NULL;

-- Over-the-counter sales (no pet visit).
CREATE TABLE sales (
  id           INTEGER PRIMARY KEY,
  branch_id    INTEGER NOT NULL DEFAULT 1,
  at           TEXT NOT NULL,
  day          TEXT NOT NULL,            -- Manila day
  customer     TEXT,
  owner_id     INTEGER REFERENCES owners (id),
  total_cents  INTEGER NOT NULL,
  staff_id     INTEGER,
  staff_name   TEXT,
  voided_at    TEXT,
  voided_by    TEXT,
  void_reason  TEXT
);
CREATE INDEX idx_sales_day ON sales (day);
CREATE TABLE sale_items (
  id           INTEGER PRIMARY KEY,
  sale_id      INTEGER NOT NULL REFERENCES sales (id),
  product_id   INTEGER REFERENCES products (id),
  name         TEXT NOT NULL,
  qty          REAL NOT NULL,
  price_cents  INTEGER
);
CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);

CREATE TABLE payments (
  id             INTEGER PRIMARY KEY,
  branch_id      INTEGER NOT NULL DEFAULT 1,
  appointment_id INTEGER REFERENCES appointments (id),
  sale_id        INTEGER REFERENCES sales (id),
  at             TEXT NOT NULL,
  day            TEXT NOT NULL,          -- Manila day
  due_cents      INTEGER NOT NULL,       -- the total from the price list
  amount_cents   INTEGER NOT NULL,       -- what was paid
  method         TEXT NOT NULL CHECK (method IN ('cash', 'gcash', 'maya', 'card', 'bank', 'no_charge')),
  reference      TEXT,
  note           TEXT,                   -- e.g. why the amount differs from the total
  staff_id       INTEGER,
  staff_name     TEXT,
  voided_at      TEXT,
  voided_by      TEXT,
  void_reason    TEXT
);
CREATE INDEX idx_payments_appt ON payments (appointment_id);
CREATE INDEX idx_payments_day ON payments (day);

-- unpaid | paid | not_tracked (visits from before payments were in the app)
ALTER TABLE appointments ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE appointments ADD COLUMN paid_at TEXT;
ALTER TABLE appointments ADD COLUMN stock_deducted_at TEXT;
UPDATE appointments SET payment_status = 'not_tracked' WHERE status IN ('completed', 'cancelled', 'no_show') OR source = 'legacy';

CREATE TABLE stock_counts (
  id            INTEGER PRIMARY KEY,
  branch_id     INTEGER NOT NULL DEFAULT 1,
  kind          TEXT NOT NULL CHECK (kind IN ('baseline', 'count')),
  started_at    TEXT NOT NULL,
  started_by    TEXT,
  finished_at   TEXT,
  finished_by   TEXT,
  cancelled_at  TEXT,
  cancelled_by  TEXT,
  note          TEXT
);
CREATE TABLE stock_count_lines (
  count_id      INTEGER NOT NULL REFERENCES stock_counts (id),
  product_id    INTEGER NOT NULL REFERENCES products (id),
  expected      REAL NOT NULL,           -- on hand when it was counted
  counted       REAL NOT NULL,
  expiry        TEXT,                    -- nearest expiry seen on the shelf
  counted_by    TEXT,
  counted_at    TEXT NOT NULL,
  PRIMARY KEY (count_id, product_id)
);
