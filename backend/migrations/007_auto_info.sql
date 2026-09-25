-- ============================================================
-- 007 – Auto-Info: Fahrzeugdaten und Jahreskosten
-- Grundlage für den Vergleich 1-%-Regel ↔ Fahrtenbuch.
-- drive_type bestimmt den Pauschalsatz:
--   verbrenner 1 %, hybrid 0,5 %, elektro 0,25 %,
--   elektro_teuer 0,5 % (E-Auto über der Preisgrenze)
-- ============================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS license_plate VARCHAR(20);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS list_price    NUMERIC(10, 2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS drive_type    VARCHAR(20) NOT NULL DEFAULT 'verbrenner'
    CHECK (drive_type IN ('verbrenner', 'hybrid', 'elektro', 'elektro_teuer'));

-- Kosten und Steuerangaben je Fahrzeug und Jahr
CREATE TABLE IF NOT EXISTS vehicle_years (
    vehicle_id    INTEGER       NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    year          INTEGER       NOT NULL,
    total_costs   NUMERIC(10, 2) NOT NULL,              -- Gesamtkosten inkl. AfA/Leasing
    depreciation  NUMERIC(10, 2) NOT NULL DEFAULT 0,    -- davon AfA bzw. Leasingraten
    commute_km    NUMERIC(6, 1)  NOT NULL DEFAULT 0,    -- einfache Entfernung Wohnung–Arbeit
    months        INTEGER        NOT NULL DEFAULT 12 CHECK (months BETWEEN 1 AND 12),
    tax_rate      NUMERIC(4, 1),                        -- persönlicher Grenzsteuersatz in %
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    PRIMARY KEY (vehicle_id, year)
);
