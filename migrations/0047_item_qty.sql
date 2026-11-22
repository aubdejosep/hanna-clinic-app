-- Receipt items get a quantity and a unit price (e.g. Prednisone 3 × 15 = 45). amount_cents stays the line's amount
-- (quantity × unit price), so every total and check works as before. Older items have neither (one of them, at
-- their amount).
ALTER TABLE cash_line_items ADD COLUMN qty REAL;
ALTER TABLE cash_line_items ADD COLUMN unit_cents INTEGER;
