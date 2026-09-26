-- ============================================================
-- 010 – Zeitpunkt der letzten Sicherung je Fahrzeug
-- Grundlage für die Erinnerung nach 30 Tagen mit Änderungen.
-- ============================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_backup_at TIMESTAMPTZ;
