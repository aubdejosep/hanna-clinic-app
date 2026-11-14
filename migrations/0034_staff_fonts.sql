-- Account ▸ Settings ▸ Font (per person, like the theme): which font each part of the app uses, and how
-- bold the menu is. JSON, e.g. {"head":"montserrat","menu":"system","text":"heros","button":"system","menuWeight":"regular"}.
-- Missing or NULL = TeX Gyre Heros everywhere, bold menu (as before).
ALTER TABLE staff ADD COLUMN fonts TEXT;
