#!/usr/bin/env node
// ============================================================
// Converts a backup file in the old format v1 (German field names and
// values, until 09/2026) to the current format v2. The backend
// only accepts v2 now.
//
//   node scripts/convert-backup.js old.json [new.json]
//
// Without a target file, <old>-v2.json is written. No dependencies,
// so it also runs outside the container with Node ≥ 20.
// Unknown values are kept as-is and get flagged on restore.
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
  const { kmstand, ziel: target, fahrtart, ...rest } = d;
  return {
    ...rest,
    ...(kmstand  !== undefined ? { odometer_km: kmstand } : {}),
    ...(target   !== undefined ? { destination: target } : {}),
    ...(fahrtart !== undefined ? { trip_type: tripType(fahrtart) } : {}),
  };
}

const trips = (list = []) => list.map(({ kmstand, ziel: target, fahrtart, ...f }) =>
  ({ ...f, odometer_km: kmstand, destination: target, trip_type: tripType(fahrtart) }));

const audit = (list = []) => list.map(({ fahrt_id, old_data, new_data, ...e }) =>
  ({ ...e, trip_id: fahrt_id, old_data: snapshot(old_data), new_data: snapshot(new_data) }));

function vehicleData({ fahrzeug: vehicle = {}, jahre: years, fahrten: tripList, protokoll: auditLog }) {
  return {
    vehicle: { ...vehicle, ...(vehicle.drive_type ? { drive_type: driveType(vehicle.drive_type) } : {}) },
    years:   years ?? [],
    trips:   trips(tripList),
    audit:   audit(auditLog),
  };
}

// Returns the file in format v2; other input unchanged
export function fromLegacyFormat(backupData) {
  if (!backupData || backupData.version !== 1) return backupData;
  const created_at = backupData.erstellt_am ?? backupData.exportiert_am;
  if (backupData.format === V1_VEHICLE) {
    return { format: VEHICLE_BACKUP_FORMAT, version: BACKUP_VERSION, created_at, ...vehicleData(backupData) };
  }
  if (backupData.format === V1_BACKUP) {
    return {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, created_at,
      vehicles:   (backupData.fahrzeuge ?? []).map(vehicleData),
      unassigned: { trips: trips(backupData.ohne_fahrzeug?.fahrten), audit: audit(backupData.ohne_fahrzeug?.protokoll) },
    };
  }
  return backupData;
}

function main([sourceFile, target]) {
  if (!sourceFile) {
    console.error("Aufruf: node scripts/convert-backup.js alt.json [neu.json]");
    process.exit(2);
  }
  const backupData = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  if (backupData?.version === BACKUP_VERSION && [VEHICLE_BACKUP_FORMAT, BACKUP_FORMAT].includes(backupData.format)) {
    console.log(`${sourceFile} ist bereits im Format v${BACKUP_VERSION} – nichts zu tun.`);
    return;
  }
  const newValue = fromLegacyFormat(backupData);
  if (newValue === backupData) {
    console.error(`${sourceFile} ist keine Fahrtenbuch-Sicherung im Format v1.`);
    process.exit(1);
  }
  target ??= path.join(path.dirname(sourceFile), `${path.basename(sourceFile, ".json")}-v2.json`);
  fs.writeFileSync(target, JSON.stringify(newValue, null, 2));
  const vehicles = newValue.vehicles ?? [newValue];
  const tripList   = vehicles.reduce((n, v) => n + v.trips.length, newValue.unassigned?.trips.length ?? 0);
  console.log(`${target} geschrieben: ${vehicles.length} Fahrzeug(e), ${tripList} Fahrten.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
