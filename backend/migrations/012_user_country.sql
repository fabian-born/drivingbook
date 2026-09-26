-- ============================================================
-- 012 – Country per user (ISO 3166-1 alpha-2)
-- The tax comparison (1% rule vs. logbook) depends on the
-- country's tax law. For now only Germany is supported, so every
-- existing and new user gets "DE".
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS country CHAR(2) NOT NULL DEFAULT 'DE'
  CHECK (country ~ '^[A-Z]{2}$');
