#!/usr/bin/env node
// ============================================================
// Sicherungsdatei im alten Format v1 (deutsche Feldnamen und Werte,
// bis 09/2026) in das aktuelle Format v2 umwandeln. Das Backend
// nimmt nur noch v2 an.
//
//   node scripts/convert-backup.js alt.json [neu.json]
//
// Ohne Zieldatei wird <alt>-v2.json geschrieben. Ohne Abhängigkeiten,
// läuft also auch außerhalb des Containers mit Node ≥ 20.
// Unbekannte Werte bleiben stehen und fallen beim Einspielen auf.
// ============================================================

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const VEHICLE_BACKUP_FORMAT = "drivingbook-vehicle";
const BACKUP_FORMAT         = "drivingbook-backup";
const BACKUP_VERSION        = 2;

const LEGACY_TRIP_TYPES  = { privat: "private", "geschäftlich": "business", arbeitsweg: "commute" };
const LEGACY_DRIVE_TYPES = { verbrenner: "combustion", hybrid: "hybrid", elektro: "electric", elektro_teuer: "electric_high_price" };

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

function main([quelle, ziel]) {
  if (!quelle) {
    console.error("Aufruf: node scripts/convert-backup.js alt.json [neu.json]");
    process.exit(2);
  }
  const daten = JSON.parse(fs.readFileSync(quelle, "utf8"));
  if (daten?.version === BACKUP_VERSION && [VEHICLE_BACKUP_FORMAT, BACKUP_FORMAT].includes(daten.format)) {
    console.log(`${quelle} ist bereits im Format v${BACKUP_VERSION} – nichts zu tun.`);
    return;
  }
  const neu = ausAltformat(daten);
  if (neu === daten) {
    console.error(`${quelle} ist keine Fahrtenbuch-Sicherung im Format v1.`);
    process.exit(1);
  }
  ziel ??= path.join(path.dirname(quelle), `${path.basename(quelle, ".json")}-v2.json`);
  fs.writeFileSync(ziel, JSON.stringify(neu, null, 2));
  const fahrzeuge = neu.vehicles ?? [neu];
  const fahrten   = fahrzeuge.reduce((n, v) => n + v.trips.length, neu.unassigned?.trips.length ?? 0);
  console.log(`${ziel} geschrieben: ${fahrzeuge.length} Fahrzeug(e), ${fahrten} Fahrten.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
