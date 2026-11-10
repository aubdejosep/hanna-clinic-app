-- The old system gives each service variation an optional description (e.g. "Bigger dogs, longer
-- anaesthesia"). Kept so the imported price list loses nothing.
ALTER TABLE service_variations ADD COLUMN description TEXT;
