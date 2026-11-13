-- Clinic-wide settings changed in the app, e.g. the logo (Account ▸ Settings ▸ Clinic Logo, owners/admins).
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT,
  updated_by  TEXT
);
