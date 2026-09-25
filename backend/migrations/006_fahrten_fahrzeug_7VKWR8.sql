-- ============================================================
-- 006 – Datenkorrektur: alle Fahrten des Besitzers von Fahrzeug
-- 7VKWR8 diesem Fahrzeug zuordnen (auch bisher fahrzeuglose).
-- Kein Eintrag im Änderungsprotokoll, da nur die Zuordnung
-- korrigiert wird. Auf Datenbanken ohne dieses Fahrzeug wirkungslos.
-- ============================================================

UPDATE fahrten f SET vehicle_id = v.id
FROM   vehicles v
WHERE  v.code = '7VKWR8'
  AND  f.user_id = v.user_id
  AND  f.vehicle_id IS DISTINCT FROM v.id;
