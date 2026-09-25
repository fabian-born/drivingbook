-- ============================================================
-- 009 – Benutzernamen eindeutig ohne Rücksicht auf Groß-/Kleinschreibung
-- Ergänzt 005: die Datenbank verhindert jetzt selbst Namen wie "Max"
-- neben "max". Gibt es solche Altfälle noch, wird der Index nicht
-- angelegt (Hinweis im Log) – die Migration bricht den Start nicht ab.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users GROUP BY LOWER(username) HAVING COUNT(*) > 1) THEN
    RAISE NOTICE 'Benutzernamen unterscheiden sich nur in Groß-/Kleinschreibung – Index users_username_lower_key nicht angelegt';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (LOWER(username));
  END IF;
END $$;
