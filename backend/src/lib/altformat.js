// ============================================================
// Sicherungsdateien im alten Format v1 (deutsche Feldnamen und
// Werte, bis 09/2026) in das aktuelle Format v2 übersetzen.
// Geprüft wird danach mit den v2-Schemas; unbekannte Werte bleiben
// stehen und fallen dort auf.
// ============================================================

import {
  BACKUP_FORMAT, BACKUP_VERSION, LEGACY_DRIVE_TYPES, LEGACY_TRIP_TYPES, VEHICLE_BACKUP_FORMAT,
} from "../schemas.js";

const V1_VEHICLE = "drivingbook-fahrzeug";
const V1_BACKUP  = "drivingbook-sicherung";

const tripType  = v => LEGACY_TRIP_TYPES[v] ?? v;
const driveType = v => LEGACY_DRIVE_TYPES[v] ?? v;

function snapshot(d) {
  if (!d || typeof d !== "object") return d ?? null;
  const { kmstand, ziel, fahrtart, ...rest } = d;
  return {
    ...rest,
    ...(kmstand  !== undefined ? { odometer_km: kmstand } : {}),
    ...(ziel     !== undefined ? { destination: ziel } : {}),
    ...(fahrtart !== undefined ? { trip_type: tripType(fahrtart) } : {}),
  };
}

const trips = (list = []) => list.map(({ kmstand, ziel, fahrtart, ...f }) =>
  ({ ...f, odometer_km: kmstand, destination: ziel, trip_type: tripType(fahrtart) }));

const audit = (list = []) => list.map(({ fahrt_id, old_data, new_data, ...e }) =>
  ({ ...e, trip_id: fahrt_id, old_data: snapshot(old_data), new_data: snapshot(new_data) }));

function vehicleData({ fahrzeug = {}, jahre, fahrten, protokoll }) {
  return {
    vehicle: { ...fahrzeug, ...(fahrzeug.drive_type ? { drive_type: driveType(fahrzeug.drive_type) } : {}) },
    years:   jahre ?? [],
    trips:   trips(fahrten),
    audit:   audit(protokoll),
  };
}

// Liefert die Datei im Format v2; andere Eingaben unverändert
export function ausAltformat(daten) {
  if (!daten || daten.version !== 1) return daten;
  const created_at = daten.erstellt_am ?? daten.exportiert_am;
  if (daten.format === V1_VEHICLE) {
    return { format: VEHICLE_BACKUP_FORMAT, version: BACKUP_VERSION, created_at, ...vehicleData(daten) };
  }
  if (daten.format === V1_BACKUP) {
    return {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, created_at,
      vehicles:   (daten.fahrzeuge ?? []).map(vehicleData),
      unassigned: { trips: trips(daten.ohne_fahrzeug?.fahrten), audit: audit(daten.ohne_fahrzeug?.protokoll) },
    };
  }
  return daten;
}
