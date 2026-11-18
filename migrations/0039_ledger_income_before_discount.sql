-- Finances ▸ Ledger: Total Income is now the amount BEFORE the discount; the Summary takes Discounts off it
-- (Total Income − Discounts = Net Income). Rows saved so far had Total Income after the discount, so add the
-- discount back (only on counted rows with a discount). Before this, only Nov 16 had discounts (Rula 05332).
UPDATE cash_lines SET income_cents = income_cents + discount_cents, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'Discounts change (0039)'
  WHERE income_cents IS NOT NULL AND discount_cents > 0 AND deleted_at IS NULL;
