-- Account menu: each person's display settings, and Device Management (where they're logged in).
ALTER TABLE staff ADD COLUMN theme TEXT;          -- brand (default) | contrast | clear
ALTER TABLE staff ADD COLUMN text_size TEXT;      -- standard (default) | large | larger
ALTER TABLE sessions ADD COLUMN ip TEXT;          -- network address at login, then at the last renewal
ALTER TABLE sessions ADD COLUMN device_name TEXT; -- a name the person gave this device, e.g. "Front desk PC"
