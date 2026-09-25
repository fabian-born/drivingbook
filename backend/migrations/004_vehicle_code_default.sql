-- ============================================================
-- 004 – Fahrzeuge: öffentlicher Code + Default-Fahrzeug
-- Jedes Fahrzeug bekommt einen 6-stelligen, eindeutigen Code
-- (statt der internen numerischen ID) für API-Aufrufe, z. B.
-- Home Assistant. Ein Fahrzeug pro User kann als Default markiert
-- werden; er wird verwendet, wenn ein API-Call keinen Code angibt.
-- ============================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS code CHAR(6);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- Bestehende Fahrzeuge: zufälligen, eindeutigen Code vergeben
-- (Zeichensatz ohne 0/O/1/I zur besseren Lesbarkeit)
DO $$
DECLARE
  v RECORD;
  new_code TEXT;
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  FOR v IN SELECT id FROM vehicles WHERE code IS NULL LOOP
    LOOP
      new_code := '';
      FOR i IN 1..6 LOOP
        new_code := new_code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM vehicles WHERE code = new_code);
    END LOOP;
    UPDATE vehicles SET code = new_code WHERE id = v.id;
  END LOOP;
END $$;

ALTER TABLE vehicles ALTER COLUMN code SET NOT NULL;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_code_key UNIQUE (code);

-- Ältestes Fahrzeug jedes Users wird Default, falls noch keins gesetzt ist
UPDATE vehicles v SET is_default = TRUE
WHERE v.id = (
  SELECT id FROM vehicles v2 WHERE v2.user_id = v.user_id ORDER BY id ASC LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM vehicles v3 WHERE v3.user_id = v.user_id AND v3.is_default = TRUE);

-- Pro User darf es nur einen Default geben
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_one_default
    ON vehicles (user_id)
    WHERE is_default = TRUE;
