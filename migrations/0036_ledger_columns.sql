-- Finances ▸ Ledger, the clinic's own sheet layout: Receipt No. OR | Receipt No. QR | Owner's Name | Pet's Name |
-- Total Per Receipt | Discounts and Notes | Online Payments | Deposit | Balance | Total Income | Commissions.
-- The date comes from the calendar. amount_cents is now "Total Per Receipt"; the method column is no longer used.
ALTER TABLE cash_lines ADD COLUMN receipt_qr TEXT;
ALTER TABLE cash_lines ADD COLUMN online_cents INTEGER;
ALTER TABLE cash_lines ADD COLUMN deposit_cents INTEGER;
ALTER TABLE cash_lines ADD COLUMN balance_cents INTEGER;
ALTER TABLE cash_lines ADD COLUMN income_cents INTEGER;
-- Rows typed in the earlier layout: their amount was received, online if it was paid online.
UPDATE cash_lines SET income_cents = amount_cents, online_cents = CASE WHEN method <> 'cash' THEN amount_cents END WHERE income_cents IS NULL;
