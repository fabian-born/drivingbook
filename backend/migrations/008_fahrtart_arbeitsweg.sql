-- ============================================================
-- 008 – Neue Fahrtart "arbeitsweg" (Fahrten Wohnung–Arbeitsstätte)
-- Der CHECK-Constraint aus 001 hat einen generierten Namen und
-- wird deshalb per Katalog gesucht und ersetzt.
-- ============================================================

DO $$
DECLARE
  c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE  conrelid = 'fahrten'::regclass AND contype = 'c'
      AND  pg_get_constraintdef(oid) LIKE '%fahrtart%'
  LOOP
    EXECUTE format('ALTER TABLE fahrten DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE fahrten ADD CONSTRAINT fahrten_fahrtart_check
    CHECK (fahrtart IN ('privat', 'geschäftlich', 'arbeitsweg'));
