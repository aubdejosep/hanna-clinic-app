-- Weight bands on service variations, for services whose sizes aren't named by weight
-- (e.g. Grooming: Small, Medium, Large, XL dog). Quick Add picks the size from the pet's weight.
-- Blank = not sized by weight. max_kg blank with min_kg set = "and up". Editable in Services.
ALTER TABLE service_variations ADD COLUMN min_kg REAL;
ALTER TABLE service_variations ADD COLUMN max_kg REAL;

-- Starting bands for Grooming (the owners will adjust them in Services ▸ Grooming).
UPDATE service_variations SET min_kg = 0, max_kg = 10
  WHERE service_id IN (SELECT id FROM services WHERE upper(name) = 'GROOMING') AND upper(name) = 'SMALL DOG';
UPDATE service_variations SET min_kg = 10.1, max_kg = 20
  WHERE service_id IN (SELECT id FROM services WHERE upper(name) = 'GROOMING') AND upper(name) IN ('MEDIUM DOG', 'MEDUIM DOG');
UPDATE service_variations SET min_kg = 20.1, max_kg = 35
  WHERE service_id IN (SELECT id FROM services WHERE upper(name) = 'GROOMING') AND upper(name) = 'LARGE DOG';
UPDATE service_variations SET min_kg = 35.1, max_kg = NULL
  WHERE service_id IN (SELECT id FROM services WHERE upper(name) = 'GROOMING') AND upper(name) IN ('XL DOG', 'GROOMING XL DOG', 'GROMMING XL DOG');
