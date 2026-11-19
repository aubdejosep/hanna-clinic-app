-- Finances ▸ Ledger becomes one record per day for everyone, with three stages per receipt:
--   draft  read by the app from its photo (or typed), waiting for staff to check it
--   staff  approved by staff
--   owner  approved by an owner or admin (locked for staff)
-- Every change to a receipt is kept in cash_line_history (what the app read, what staff and owners changed). Owner
-- Notes and Commissions are for owners and admins only. Staff's and owners' separate records (book 'staff' /
-- 'owner', 0041) are combined here: nothing is erased.

ALTER TABLE cash_lines ADD COLUMN stage TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE cash_lines ADD COLUMN staff_approved_at TEXT;
ALTER TABLE cash_lines ADD COLUMN staff_approved_by TEXT;
ALTER TABLE cash_lines ADD COLUMN owner_approved_at TEXT;
ALTER TABLE cash_lines ADD COLUMN owner_approved_by TEXT;
ALTER TABLE cash_lines ADD COLUMN owner_note TEXT;         -- owners and admins only
ALTER TABLE cash_lines ADD COLUMN issue_note TEXT;         -- "discuss tomorrow": a discrepancy left open
ALTER TABLE cash_lines ADD COLUMN ai_reading TEXT;         -- JSON: what the app read from the photo (and which model, tokens)
ALTER TABLE cash_lines ADD COLUMN ai_read_at TEXT;

CREATE TABLE cash_line_history (
  id         INTEGER PRIMARY KEY,
  line_id    INTEGER NOT NULL REFERENCES cash_lines (id),
  field      TEXT NOT NULL,          -- e.g. amountCents, item, stage, staff_version
  old_value  TEXT,
  new_value  TEXT,
  source     TEXT NOT NULL,          -- app | staff | owner | system
  by_name    TEXT,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_cash_line_history_line ON cash_line_history (line_id, id);

-- One row per day: staff's Mark Day Done and the owner's Day Checked.
CREATE TABLE cash_days (
  id             INTEGER PRIMARY KEY,
  branch_id      INTEGER NOT NULL DEFAULT 1,
  day            TEXT NOT NULL,
  staff_done_at  TEXT,
  staff_done_by  TEXT,
  owner_done_at  TEXT,
  owner_done_by  TEXT
);
CREATE UNIQUE INDEX idx_cash_days_day ON cash_days (branch_id, day);

-- Rows already in the owners' Ledger count as approved by an owner.
UPDATE cash_lines SET owner_approved_at = COALESCE(updated_at, created_at), owner_approved_by = 'Approved before the change'
  WHERE book = 'owner';

-- Staff's rows that match an owners' row (same day and receipt number): the owners' row keeps its values and gets
-- staff's photo when it has none; staff's version is kept in its history; staff's row is marked removed.
UPDATE cash_lines SET
  photo_key = (SELECT s.photo_key FROM cash_lines s WHERE s.book = 'staff' AND s.deleted_at IS NULL AND s.day = cash_lines.day AND s.photo_key IS NOT NULL
    AND ((cash_lines.receipt_no IS NOT NULL AND s.receipt_no = cash_lines.receipt_no) OR (cash_lines.receipt_qr IS NOT NULL AND s.receipt_qr = cash_lines.receipt_qr)) ORDER BY s.id LIMIT 1),
  photo_type = (SELECT s.photo_type FROM cash_lines s WHERE s.book = 'staff' AND s.deleted_at IS NULL AND s.day = cash_lines.day AND s.photo_key IS NOT NULL
    AND ((cash_lines.receipt_no IS NOT NULL AND s.receipt_no = cash_lines.receipt_no) OR (cash_lines.receipt_qr IS NOT NULL AND s.receipt_qr = cash_lines.receipt_qr)) ORDER BY s.id LIMIT 1),
  photo_rotate = COALESCE((SELECT s.photo_rotate FROM cash_lines s WHERE s.book = 'staff' AND s.deleted_at IS NULL AND s.day = cash_lines.day AND s.photo_key IS NOT NULL
    AND ((cash_lines.receipt_no IS NOT NULL AND s.receipt_no = cash_lines.receipt_no) OR (cash_lines.receipt_qr IS NOT NULL AND s.receipt_qr = cash_lines.receipt_qr)) ORDER BY s.id LIMIT 1), 0)
  WHERE book = 'owner' AND deleted_at IS NULL AND photo_key IS NULL AND EXISTS (SELECT 1 FROM cash_lines s WHERE s.book = 'staff' AND s.deleted_at IS NULL AND s.day = cash_lines.day
    AND s.photo_key IS NOT NULL AND ((cash_lines.receipt_no IS NOT NULL AND s.receipt_no = cash_lines.receipt_no) OR (cash_lines.receipt_qr IS NOT NULL AND s.receipt_qr = cash_lines.receipt_qr)));

INSERT INTO cash_line_history (line_id, field, old_value, new_value, source, by_name)
  SELECT o.id, 'staff_version', NULL, json_object('receiptNo', s.receipt_no, 'receiptQr', s.receipt_qr, 'clientName', s.client_name, 'petNames', s.pet_names,
      'amountCents', s.amount_cents, 'discountCents', s.discount_cents, 'paidWith', s.paid_with, 'note', s.note, 'photoKey', s.photo_key, 'typedBy', COALESCE(s.updated_by, s.created_by)), 'system', 'Combined into one Ledger'
  FROM cash_lines s JOIN cash_lines o ON o.book = 'owner' AND o.deleted_at IS NULL AND o.day = s.day
    AND ((o.receipt_no IS NOT NULL AND s.receipt_no = o.receipt_no) OR (o.receipt_qr IS NOT NULL AND s.receipt_qr = o.receipt_qr))
  WHERE s.book = 'staff' AND s.deleted_at IS NULL;

UPDATE cash_lines SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), deleted_by = 'Combined into one Ledger (0043)'
  WHERE book = 'staff' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM cash_lines o WHERE o.book = 'owner' AND o.deleted_at IS NULL AND o.day = cash_lines.day
    AND ((o.receipt_no IS NOT NULL AND cash_lines.receipt_no = o.receipt_no) OR (o.receipt_qr IS NOT NULL AND cash_lines.receipt_qr = o.receipt_qr)));

-- Staff's other rows join the Ledger: typed ones as approved by staff, untyped photo rows as drafts.
UPDATE cash_lines SET stage = CASE WHEN receipt_no IS NOT NULL OR receipt_qr IS NOT NULL OR client_name IS NOT NULL OR amount_cents > 0 THEN 'staff' ELSE 'draft' END,
  staff_approved_at = CASE WHEN receipt_no IS NOT NULL OR receipt_qr IS NOT NULL OR client_name IS NOT NULL OR amount_cents > 0 THEN COALESCE(updated_at, created_at) END,
  staff_approved_by = CASE WHEN receipt_no IS NOT NULL OR receipt_qr IS NOT NULL OR client_name IS NOT NULL OR amount_cents > 0 THEN COALESCE(updated_by, created_by) END,
  book = 'owner'
  WHERE book = 'staff' AND deleted_at IS NULL;

-- Staff's expenses: a duplicate of an owners' expense (same day, amount and description) is marked removed; the rest join.
UPDATE cash_expenses SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), deleted_by = 'Combined into one Ledger (0043)'
  WHERE book = 'staff' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM cash_expenses o WHERE o.book = 'owner' AND o.deleted_at IS NULL AND o.day = cash_expenses.day
    AND o.amount_cents = cash_expenses.amount_cents AND lower(COALESCE(o.description, '')) = lower(COALESCE(cash_expenses.description, '')));
UPDATE cash_expenses SET book = 'owner' WHERE book = 'staff' AND deleted_at IS NULL;

CREATE INDEX idx_cash_lines_day_stage ON cash_lines (branch_id, day, stage) WHERE deleted_at IS NULL;
