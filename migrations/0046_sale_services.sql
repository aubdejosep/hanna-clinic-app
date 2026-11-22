-- Sell Items can sell a service (e.g. Bravecto, a size of it) as well as a product: which service and size a sale
-- line was. Stock comes off through the service's Uses from Stock links, as on a visit.
ALTER TABLE sale_items ADD COLUMN service_id INTEGER REFERENCES services (id);
ALTER TABLE sale_items ADD COLUMN variation_id INTEGER REFERENCES service_variations (id);
