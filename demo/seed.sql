-- ============================================================
-- Fahrtenbuch – demo data
--
-- Called by reset.sh (psql variables demo_password, admin_password,
-- seed_admin). Empties all data tables and creates the demo users,
-- vehicles and trips from January 1 of the previous year until today.
--
-- Users and vehicles get fixed IDs and codes: whoever is logged in as
-- "demo" stays logged in across a reset, and the vehicle remembered in
-- the browser still matches. The sequences are not reset – users
-- created by visitors never get an ID that is handed out again later.
--
-- Destinations are German on purpose: the tax comparison follows German law.
-- ============================================================

SET client_min_messages = warning;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

TRUNCATE users, vehicles, api_tokens, trips, trip_audit, vehicle_years CASCADE;

-- Same random sequence on every reset
SELECT setseed(0.42);

-- ── Users ───────────────────────────────────────────────────
INSERT INTO users (id, username, password, role, country) VALUES
  (1, 'demo', crypt(:'demo_password', gen_salt('bf', 10)), 'user', 'DE');

\if :seed_admin
INSERT INTO users (id, username, password, role, country) VALUES
  (2, 'admin', crypt(:'admin_password', gen_salt('bf', 10)), 'admin', 'DE');
\endif

-- Default token per user (plaintext unknown, as after a sign-up)
INSERT INTO api_tokens (user_id, token_hash, label, is_default)
SELECT id, encode(sha256(gen_random_bytes(32)), 'hex'), 'Default', TRUE FROM users;

-- ── Vehicles ────────────────────────────────────────────────
INSERT INTO vehicles (id, user_id, name, code, is_default, license_plate, list_price, drive_type, last_backup_at) VALUES
  (1, 1, 'VW Passat Variant', 'DEMPKW', TRUE,  'M-DB 1234', 48500, 'combustion', NOW() - INTERVAL '5 days'),
  (2, 1, 'VW ID.3',           'DEMEV2', FALSE, 'M-DB 567E', 39900, 'electric',   NOW() - INTERVAL '5 days');

\if :seed_admin
INSERT INTO vehicles (id, user_id, name, code, is_default, license_plate, list_price, drive_type, last_backup_at) VALUES
  (3, 2, 'BMW 330e Touring', 'ADMHYB', TRUE, 'M-AD 330E', 56900, 'hybrid', NOW() - INTERVAL '5 days');
\endif

-- Costs for the comparison 1% rule ↔ logbook
INSERT INTO vehicle_years (vehicle_id, year, total_costs, depreciation, commute_km, months, tax_rate)
SELECT v.id, y.year, v.costs, v.afa, v.commute, 12, 42
FROM   (VALUES (1, 9800.00, 5200.00, 18.0),
               (2, 6900.00, 4400.00,  0.0),
               (3, 11200.00, 6800.00, 25.0)) AS v(id, costs, afa, commute)
JOIN   vehicles ON vehicles.id = v.id
CROSS  JOIN (VALUES (EXTRACT(YEAR FROM NOW())::int - 1), (EXTRACT(YEAR FROM NOW())::int)) AS y(year);

-- ── Trips ───────────────────────────────────────────────────
-- Create a trip: increase the odometer by km, skip trips in the future
CREATE FUNCTION pg_temp.drive(p_user int, p_vehicle int, INOUT p_odometer int,
                              p_day date, p_time time, p_km int,
                              p_destination text, p_type text) AS $$
DECLARE
  ts timestamptz := (p_day + p_time) AT TIME ZONE 'Europe/Berlin';
BEGIN
  p_odometer := p_odometer + p_km;
  IF ts <= NOW() THEN
    INSERT INTO trips (user_id, vehicle_id, odometer_km, destination, trip_type, timestamp)
    VALUES (p_user, p_vehicle, p_odometer, p_destination, p_type, ts);
  END IF;
END $$ LANGUAGE plpgsql;

-- Random index into a list of n elements
CREATE FUNCTION pg_temp.pick(n int) RETURNS int AS $$
  SELECT 1 + floor(random() * n)::int
$$ LANGUAGE sql VOLATILE;

-- One driving profile from January 1 of the previous year until today
--   commuter: office on weekdays, customer visits now and then, private at weekends
--   family:   second car, short private trips, rarely business
--   field:    field sales, customers almost every day
CREATE FUNCTION pg_temp.seed_trips(p_user int, p_vehicle int, p_odometer int, p_profile text) RETURNS void AS $$
DECLARE
  home      text   := 'Zuhause';
  office    text   := 'Büro, Leopoldstraße 50, München';
  commute   int    := 18;
  customers text[] := ARRAY['Kunde Huber GmbH, Augsburg', 'Stadtwerke Rosenheim', 'Messe München, Riem',
                            'Kunde Bergmann AG, Ingolstadt', 'Steuerbüro Maier, Freising', 'Lieferant Wagner KG, Landshut',
                            'Kunde Alpenland Logistik, Garmisch', 'Hotel am Chiemsee (Workshop)'];
  cust_km   int[]  := ARRAY[68, 64, 21, 80, 38, 72, 92, 85];
  errands   text[] := ARRAY['Supermarkt', 'Baumarkt', 'Kita Sonnenschein', 'Sportverein', 'Arzt', 'Getränkemarkt'];
  trips_out text[] := ARRAY['Ausflug Tegernsee', 'Eltern, Nürnberg', 'Wandern am Spitzingsee', 'Freunde, Regensburg', 'Therme Erding'];
  trip_km   int[]  := ARRAY[55, 170, 62, 125, 40];
  d         date;
  dow       int;
  i         int;
  km        int    := p_odometer;
BEGIN
  FOR d IN SELECT generate_series(date_trunc('year', NOW()) - INTERVAL '1 year', NOW(), INTERVAL '1 day')::date LOOP
    dow := EXTRACT(ISODOW FROM d);

    -- Vacation: whole weeks without trips
    CONTINUE WHEN EXTRACT(WEEK FROM d) IN (8, 23, 32, 33, 52);

    IF p_profile = 'commuter' THEN
      IF dow <= 5 AND random() > 0.1 THEN
        km := pg_temp.drive(p_user, p_vehicle, km, d, '07:35'::time + random() * INTERVAL '25 min', commute + pg_temp.pick(3) - 1, office, 'commute');
        IF random() < 0.25 THEN
          i := pg_temp.pick(array_length(customers, 1));
          km := pg_temp.drive(p_user, p_vehicle, km, d, '10:30'::time + random() * INTERVAL '60 min', cust_km[i] + pg_temp.pick(5), customers[i], 'business');
          km := pg_temp.drive(p_user, p_vehicle, km, d, '14:30'::time + random() * INTERVAL '60 min', cust_km[i] + pg_temp.pick(5), office, 'business');
        END IF;
        km := pg_temp.drive(p_user, p_vehicle, km, d, '17:10'::time + random() * INTERVAL '50 min', commute + pg_temp.pick(3) - 1, home, 'commute');
      ELSIF dow = 6 AND random() < 0.6 THEN
        km := pg_temp.drive(p_user, p_vehicle, km, d, '10:00'::time + random() * INTERVAL '90 min', 3 + pg_temp.pick(12), errands[pg_temp.pick(array_length(errands, 1))], 'private');
        km := pg_temp.drive(p_user, p_vehicle, km, d, '12:30'::time + random() * INTERVAL '60 min', 3 + pg_temp.pick(12), home, 'private');
      ELSIF dow = 7 AND random() < 0.3 THEN
        i := pg_temp.pick(array_length(trips_out, 1));
        km := pg_temp.drive(p_user, p_vehicle, km, d, '09:30'::time + random() * INTERVAL '60 min', trip_km[i], trips_out[i], 'private');
        km := pg_temp.drive(p_user, p_vehicle, km, d, '17:00'::time + random() * INTERVAL '90 min', trip_km[i] + pg_temp.pick(4), home, 'private');
      END IF;

    ELSIF p_profile = 'family' THEN
      IF random() < 0.45 THEN
        km := pg_temp.drive(p_user, p_vehicle, km, d, '08:00'::time + random() * INTERVAL '8 hours', 2 + pg_temp.pick(10), errands[pg_temp.pick(array_length(errands, 1))], 'private');
        km := pg_temp.drive(p_user, p_vehicle, km, d, '16:30'::time + random() * INTERVAL '2 hours', 2 + pg_temp.pick(10), home, 'private');
      END IF;
      IF dow <= 5 AND random() < 0.04 THEN
        i := pg_temp.pick(array_length(customers, 1));
        km := pg_temp.drive(p_user, p_vehicle, km, d, '19:00', cust_km[i] + pg_temp.pick(5), customers[i], 'business');
        km := pg_temp.drive(p_user, p_vehicle, km, d, '21:30', cust_km[i] + pg_temp.pick(5), home, 'business');
      END IF;

    ELSIF p_profile = 'field' THEN
      IF dow <= 5 AND random() > 0.08 THEN
        FOR n IN 1 .. 1 + pg_temp.pick(2) LOOP
          i := pg_temp.pick(array_length(customers, 1));
          km := pg_temp.drive(p_user, p_vehicle, km, d, '07:00'::time + (n * 3) * INTERVAL '1 hour' + random() * INTERVAL '45 min', cust_km[i] + pg_temp.pick(10), customers[i], 'business');
        END LOOP;
        km := pg_temp.drive(p_user, p_vehicle, km, d, '17:30'::time + random() * INTERVAL '60 min', 40 + pg_temp.pick(50), home, 'business');
      ELSIF dow >= 6 AND random() < 0.4 THEN
        km := pg_temp.drive(p_user, p_vehicle, km, d, '11:00'::time + random() * INTERVAL '2 hours', 5 + pg_temp.pick(20), errands[pg_temp.pick(array_length(errands, 1))], 'private');
        km := pg_temp.drive(p_user, p_vehicle, km, d, '15:00'::time + random() * INTERVAL '2 hours', 5 + pg_temp.pick(20), home, 'private');
      END IF;
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql;

SELECT pg_temp.seed_trips(1, 1, 42180, 'commuter');
SELECT pg_temp.seed_trips(1, 2,  8730, 'family');
\if :seed_admin
SELECT pg_temp.seed_trips(2, 3, 61450, 'field');
\endif

-- A few trips edited afterwards (audit log)
INSERT INTO trip_audit (trip_id, user_id, action, old_data, new_data, source, changed_at)
SELECT t.id, t.user_id, 'update',
       jsonb_build_object('odometer_km', t.odometer_km + 10, 'destination', t.destination, 'trip_type', t.trip_type,
                          'timestamp', t.timestamp, 'vehicle_id', t.vehicle_id),
       jsonb_build_object('odometer_km', t.odometer_km, 'destination', t.destination, 'trip_type', t.trip_type,
                          'timestamp', t.timestamp, 'vehicle_id', t.vehicle_id),
       'web', t.timestamp + INTERVAL '2 hours'
FROM   (SELECT * FROM trips WHERE vehicle_id = 1 AND trip_type = 'business' ORDER BY timestamp DESC LIMIT 2) t;

-- Move the sequences past the fixed IDs, but never back
SELECT setval('users_id_seq',    GREATEST((SELECT last_value FROM users_id_seq),    3));
SELECT setval('vehicles_id_seq', GREATEST((SELECT last_value FROM vehicles_id_seq), 3));

COMMIT;
