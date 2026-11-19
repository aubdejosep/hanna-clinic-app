-- Back to two records per day (owners' decision): Finances ▸ Receipts is staff's again (book 'staff') and
-- Finances ▸ Ledger the owners' (book 'owner'), as before 0043. Undoes 0043's combining; nothing is erased.
-- 0043's columns and tables (stage, approvals, cash_line_history, cash_days) stay but are no longer used.

-- Staff's own copies that 0043 marked removed (a receipt both had) come back on staff's Receipts.
UPDATE cash_lines SET deleted_at = NULL, deleted_by = NULL WHERE deleted_by = 'Combined into one Ledger (0043)';
UPDATE cash_expenses SET deleted_at = NULL, deleted_by = NULL WHERE deleted_by = 'Combined into one Ledger (0043)';

-- Those receipts' photos go back to staff's rows only (0043 had copied them onto the owners' rows).
UPDATE cash_lines SET photo_key = NULL, photo_type = NULL, photo_rotate = 0
  WHERE book = 'owner' AND photo_key IS NOT NULL AND EXISTS (SELECT 1 FROM cash_lines s WHERE s.book = 'staff' AND s.photo_key = cash_lines.photo_key AND s.id <> cash_lines.id);

-- Receipts back on staff's record: typed or uploaded by a staff member who isn't an owner or admin, and receipts that
-- were staff's before 0043 (not in the owners' Ledger then, and not reopened from it since). Imports and rows loaded
-- from a file (created_by e.g. "From the receipt photos") stay in the Ledger.
UPDATE cash_lines SET book = 'staff'
  WHERE book = 'owner' AND import_id IS NULL AND (
    EXISTS (SELECT 1 FROM staff s WHERE s.role NOT IN ('owner', 'admin') AND trim(s.first_name || ' ' || s.last_name) = cash_lines.created_by)
    OR (NOT EXISTS (SELECT 1 FROM cash_line_history h WHERE h.line_id = cash_lines.id AND h.field = 'added')
        AND COALESCE(owner_approved_by, '') <> 'Approved before the change'
        AND NOT EXISTS (SELECT 1 FROM cash_line_history h WHERE h.line_id = cash_lines.id AND h.field = 'stage' AND h.new_value LIKE '%(reopened)')));

-- Expenses typed by a staff member who isn't an owner or admin go back on staff's record.
UPDATE cash_expenses SET book = 'staff'
  WHERE book = 'owner' AND import_id IS NULL
    AND EXISTS (SELECT 1 FROM staff s WHERE s.role NOT IN ('owner', 'admin') AND trim(s.first_name || ' ' || s.last_name) = cash_expenses.created_by);
