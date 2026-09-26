-- ============================================================
-- 013 – Preferred UI language per user (ISO 639-1)
-- NULL = automatic (the browser language decides).
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(2)
  CHECK (language ~ '^[a-z]{2}$');
