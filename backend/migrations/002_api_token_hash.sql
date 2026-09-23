-- ============================================================
-- 002 – API-Tokens nur noch als SHA-256-Hash speichern
-- Nur für Datenbanken, die noch die alte Klartext-Spalte "token"
-- haben. Bestehende Tokens funktionieren danach weiter, können
-- aber nicht mehr im Klartext ausgelesen werden.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = current_schema()
      AND  table_name   = 'api_tokens'
      AND  column_name  = 'token'
  ) THEN
    -- Früher per init.sql angelegte, öffentlich bekannte Tokens widerrufen
    DELETE FROM api_tokens WHERE token LIKE 'fahrtenbuch-default-token-CHANGE-ME-%';

    ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);
    UPDATE api_tokens SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex');

    ALTER TABLE api_tokens DROP COLUMN token;
    ALTER TABLE api_tokens ALTER COLUMN token_hash SET NOT NULL;
    ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_token_hash_key UNIQUE (token_hash);
  END IF;
END $$;
