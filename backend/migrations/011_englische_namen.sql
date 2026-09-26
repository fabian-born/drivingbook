-- ============================================================
-- 011 – Datenbank auf englische Namen umstellen
--
--   fahrten        → trips        kmstand → odometer_km
--                                 ziel    → destination
--                                 fahrtart → trip_type
--   fahrten_audit  → trip_audit   fahrt_id → trip_id
--
-- Werte:  privat / geschäftlich / arbeitsweg → private / business / commute
--         verbrenner / elektro / elektro_teuer → combustion / electric / electric_high_price
--
-- Die Momentaufnahmen im Änderungsprotokoll (old_data/new_data) werden mit
-- umgeschrieben. Die API bleibt unverändert deutsch – die Übersetzung
-- übernimmt backend/src/lib/dbschema.js.
-- Läuft wie jede Migration in einer Transaktion: ganz oder gar nicht.
-- ============================================================

-- Constraint umbenennen, falls vorhanden (Namen stammen teils von PostgreSQL)
CREATE FUNCTION pg_temp.umbenennen(tabelle regclass, alt text, neu text) RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = tabelle AND conname = alt) THEN
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', tabelle, alt, neu);
  END IF;
END $$ LANGUAGE plpgsql;

-- Alle CHECK-Constraints einer Tabelle entfernen, die eine bestimmte Spalte prüfen
CREATE FUNCTION pg_temp.check_entfernen(tabelle regclass, spalte text) RETURNS void AS $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = tabelle AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%' || spalte || '%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tabelle, c);
  END LOOP;
END $$ LANGUAGE plpgsql;

-- ── Fahrten ─────────────────────────────────────────────────
SELECT pg_temp.check_entfernen('fahrten', 'fahrtart');

ALTER TABLE fahrten RENAME TO trips;
ALTER SEQUENCE fahrten_id_seq RENAME TO trips_id_seq;
ALTER TABLE trips RENAME COLUMN kmstand  TO odometer_km;
ALTER TABLE trips RENAME COLUMN ziel     TO destination;
ALTER TABLE trips RENAME COLUMN fahrtart TO trip_type;

UPDATE trips SET trip_type = CASE trip_type
  WHEN 'privat'       THEN 'private'
  WHEN 'geschäftlich' THEN 'business'
  WHEN 'arbeitsweg'   THEN 'commute'
  ELSE trip_type
END;
ALTER TABLE trips ADD CONSTRAINT trips_trip_type_check
  CHECK (trip_type IN ('private', 'business', 'commute'));

SELECT pg_temp.umbenennen('trips', 'fahrten_pkey',            'trips_pkey');
SELECT pg_temp.umbenennen('trips', 'fahrten_user_id_fkey',    'trips_user_id_fkey');
SELECT pg_temp.umbenennen('trips', 'fahrten_vehicle_id_fkey', 'trips_vehicle_id_fkey');
ALTER INDEX IF EXISTS idx_fahrten_user_timestamp RENAME TO idx_trips_user_timestamp;
ALTER INDEX IF EXISTS idx_fahrten_vehicle        RENAME TO idx_trips_vehicle;

-- ── Änderungsprotokoll ──────────────────────────────────────
ALTER TABLE fahrten_audit RENAME TO trip_audit;
ALTER SEQUENCE fahrten_audit_id_seq RENAME TO trip_audit_id_seq;
ALTER TABLE trip_audit RENAME COLUMN fahrt_id TO trip_id;

SELECT pg_temp.umbenennen('trip_audit', 'fahrten_audit_pkey',         'trip_audit_pkey');
SELECT pg_temp.umbenennen('trip_audit', 'fahrten_audit_user_id_fkey', 'trip_audit_user_id_fkey');
SELECT pg_temp.umbenennen('trip_audit', 'fahrten_audit_action_check', 'trip_audit_action_check');
ALTER INDEX IF EXISTS idx_fahrten_audit_fahrt        RENAME TO idx_trip_audit_trip;
ALTER INDEX IF EXISTS idx_fahrten_audit_user_changed RENAME TO idx_trip_audit_user_changed;

-- Momentaufnahme einer Fahrt: Schlüssel und Fahrtart übersetzen,
-- übrige Felder (timestamp, vehicle_id) bleiben
CREATE FUNCTION pg_temp.fahrt_json(d jsonb) RETURNS jsonb AS $$
  SELECT CASE WHEN d IS NULL THEN NULL ELSE
    (d - 'kmstand' - 'ziel' - 'fahrtart')
    || jsonb_strip_nulls(jsonb_build_object(
         'odometer_km', d->'kmstand',
         'destination', d->'ziel',
         'trip_type',   CASE d->>'fahrtart'
                          WHEN 'privat'       THEN '"private"'::jsonb
                          WHEN 'geschäftlich' THEN '"business"'::jsonb
                          WHEN 'arbeitsweg'   THEN '"commute"'::jsonb
                          ELSE d->'fahrtart'
                        END))
  END
$$ LANGUAGE sql IMMUTABLE;

UPDATE trip_audit
SET    old_data = pg_temp.fahrt_json(old_data),
       new_data = pg_temp.fahrt_json(new_data)
WHERE  old_data IS NOT NULL OR new_data IS NOT NULL;

-- ── Fahrzeuge: Antriebsart ──────────────────────────────────
SELECT pg_temp.check_entfernen('vehicles', 'drive_type');

UPDATE vehicles SET drive_type = CASE drive_type
  WHEN 'verbrenner'    THEN 'combustion'
  WHEN 'elektro'       THEN 'electric'
  WHEN 'elektro_teuer' THEN 'electric_high_price'
  ELSE drive_type
END;
ALTER TABLE vehicles ALTER COLUMN drive_type SET DEFAULT 'combustion';
ALTER TABLE vehicles ADD CONSTRAINT vehicles_drive_type_check
  CHECK (drive_type IN ('combustion', 'hybrid', 'electric', 'electric_high_price'));
