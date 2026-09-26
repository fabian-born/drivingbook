// ============================================================
// Backup and restore
//
// Single backup (vehicle info): { format: "drivingbook-vehicle", version: 2,
//                                 created_at, vehicle, years, trips, audit }
// Full backup (account):        { format: "drivingbook-backup", version: 2,
//                                 created_at, vehicles: [...], unassigned }
// Convert files in the old v1 format (German) with scripts/convert-backup.js first.
//
// Restoring only adds: vehicles are matched by their code (if one is
// missing, it is created, keeping its code if still available);
// existing trips (timestamp + odometer reading), annual costs and audit
// log entries are left untouched. Trips left without a vehicle after a
// vehicle was deleted are reassigned. The audit log is taken over
// unchanged; only trip and vehicle IDs are rewritten to the new IDs.
// ============================================================

import { HttpError } from "../http.js";
import { BACKUP_FORMAT, BACKUP_VERSION, VEHICLE_BACKUP_FORMAT } from "../schemas.js";
import { createVehicle } from "./vehicles.js";
import { AUDIT_FIELDS } from "./fahrten.js";

// The backend no longer accepts files in the old v1 format – reject with a hint
export function ohneAltformat(daten) {
  if (daten?.version === 1) {
    throw new HttpError(400, "Sicherung im alten Format v1 – bitte zuerst mit scripts/convert-backup.js umwandeln");
  }
  return daten;
}

// Trip columns in the backup format
const SICHERUNG_FAHRT = "id, odometer_km, destination, trip_type, timestamp";

// ── Backup ───────────────────────────────────────────────────

async function fahrzeugDaten(db, userId, vehicleId) {
  const [vehicle, jahre, fahrten, protokoll] = await Promise.all([
    db.query(
      `SELECT id, name, code, license_plate, list_price::float8 AS list_price, drive_type
       FROM vehicles WHERE id = $1 AND user_id = $2`,
      [vehicleId, userId]
    ),
    db.query(
      `SELECT year, total_costs::float8 AS total_costs, depreciation::float8 AS depreciation,
              commute_km::float8 AS commute_km, months, tax_rate::float8 AS tax_rate
       FROM vehicle_years WHERE vehicle_id = $1 ORDER BY year`,
      [vehicleId]
    ),
    db.query(
      `SELECT ${SICHERUNG_FAHRT}
       FROM trips WHERE user_id = $1 AND vehicle_id = $2 ORDER BY timestamp, id`,
      [userId, vehicleId]
    ),
    // Also entries of deleted or reassigned trips of this vehicle
    db.query(
      `SELECT trip_id, action, old_data, new_data, source, changed_at
       FROM   trip_audit
       WHERE  user_id = $1
         AND  (trip_id IN (SELECT id FROM trips WHERE user_id = $1 AND vehicle_id = $2)
               OR (old_data->>'vehicle_id')::int = $2
               OR (new_data->>'vehicle_id')::int = $2)
       ORDER  BY changed_at, id`,
      [userId, vehicleId]
    ),
  ]);
  if (vehicle.rows.length === 0) return null;
  return { vehicle: vehicle.rows[0], years: jahre.rows, trips: fahrten.rows, audit: protokoll.rows };
}

async function merkeSicherung(db, vehicleIds) {
  await db.query(`UPDATE vehicles SET last_backup_at = NOW() WHERE id = ANY($1::int[])`, [vehicleIds]);
}

export async function sichereFahrzeug(db, userId, vehicleId) {
  const daten = await fahrzeugDaten(db, userId, vehicleId);
  if (!daten) return null;
  await merkeSicherung(db, [vehicleId]);
  return { format: VEHICLE_BACKUP_FORMAT, version: BACKUP_VERSION, created_at: new Date().toISOString(), ...daten };
}

export async function sichereAlles(db, userId) {
  const vehicles = (await db.query(`SELECT id FROM vehicles WHERE user_id = $1 ORDER BY id`, [userId])).rows;
  const fahrzeuge = [];
  for (const v of vehicles) fahrzeuge.push(await fahrzeugDaten(db, userId, v.id));

  const [fahrten, protokoll] = await Promise.all([
    db.query(
      `SELECT ${SICHERUNG_FAHRT}
       FROM trips WHERE user_id = $1 AND vehicle_id IS NULL ORDER BY timestamp, id`,
      [userId]
    ),
    db.query(
      `SELECT trip_id, action, old_data, new_data, source, changed_at
       FROM   trip_audit
       WHERE  user_id = $1 AND trip_id IN (SELECT id FROM trips WHERE user_id = $1 AND vehicle_id IS NULL)
       ORDER  BY changed_at, id`,
      [userId]
    ),
  ]);

  await merkeSicherung(db, vehicles.map(v => v.id));
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, created_at: new Date().toISOString(),
    vehicles:   fahrzeuge,
    unassigned: { trips: fahrten.rows, audit: protokoll.rows },
  };
}

// ── Restore ──────────────────────────────────────────────────

// Identifies the same audit log entry
function auditSchluessel(action, changedAt, oldData, newData) {
  const d = oldData ?? newData ?? {};
  return `${action}|${new Date(changedAt).toISOString()}|${d.timestamp ? new Date(d.timestamp).toISOString() : ""}|${d.odometer_km ?? ""}`;
}

// Reserves n new trip IDs from the sequence of the trips table
async function neueFahrtIds(db, n) {
  if (n === 0) return [];
  const result = await db.query(
    `SELECT nextval('trips_id_seq')::int AS id FROM generate_series(1, $1)`,
    [n]
  );
  return result.rows.map(r => r.id);
}

// Assigns trip IDs for trips or audit log entries being imported. The
// original ID is reused if this database has already issued it itself
// (≤ current sequence value), no trip occupies it and any audit log present
// there provably belongs to exactly this trip – so a restored trip is
// reattached to its history. Otherwise a new ID is used.
// The sequence is never adjusted (a crafted file with huge IDs could
// otherwise exhaust it for all users).
async function vergebeFahrtIds(db, userId, alteIds, protokoll) {
  const idMap = new Map();
  if (alteIds.length === 0) return idMap;

  const stand = Number((await db.query(`SELECT last_value, is_called FROM trips_id_seq`)).rows
    .map(r => (r.is_called ? r.last_value : Number(r.last_value) - 1))[0]);
  const kandidaten = alteIds.filter(id => id > 0 && id <= stand);

  const [belegt, audits] = await Promise.all([
    db.query(`SELECT id FROM trips WHERE id = ANY($1::int[])`, [kandidaten]),
    db.query(
      `SELECT trip_id, user_id, action, changed_at, old_data, new_data
       FROM trip_audit WHERE trip_id = ANY($1::int[])`,
      [kandidaten]
    ),
  ]);
  const belegteIds = new Set(belegt.rows.map(r => r.id));

  const sicherungsSchluessel = new Map();
  for (const e of protokoll) {
    if (!sicherungsSchluessel.has(e.trip_id)) sicherungsSchluessel.set(e.trip_id, new Set());
    sicherungsSchluessel.get(e.trip_id).add(auditSchluessel(e.action, e.changed_at, e.old_data, e.new_data));
  }
  const fremd = new Set();
  for (const a of audits.rows) {
    const passt = a.user_id === userId &&
      sicherungsSchluessel.get(a.trip_id)?.has(auditSchluessel(a.action, a.changed_at, a.old_data, a.new_data));
    if (!passt) fremd.add(a.trip_id);
  }

  const wiederverwendet = new Set(kandidaten.filter(id => !belegteIds.has(id) && !fremd.has(id)));
  const rest = alteIds.filter(id => !wiederverwendet.has(id));
  for (const id of wiederverwendet) idMap.set(id, id);
  (await neueFahrtIds(db, rest.length)).forEach((id, i) => idMap.set(rest[i], id));
  return idMap;
}

// Restrict audit data to the known fields, rewrite vehicle IDs
function mappeAuditDaten(daten, vehicleMap) {
  if (!daten) return null;
  const ergebnis = {};
  for (const feld of AUDIT_FIELDS) {
    if (!(feld in daten)) continue;
    ergebnis[feld] = feld === "vehicle_id"
      ? (vehicleMap.get(daten.vehicle_id) ?? null)
      : daten[feld];
  }
  return ergebnis;
}

// User's vehicle with the same code – otherwise create it (name and code kept if available).
// For an existing vehicle, only empty fields are filled in.
async function zielFahrzeug(db, userId, fahrzeug) {
  if (fahrzeug.code) {
    const vorhanden = await db.query(
      `UPDATE vehicles
       SET    license_plate = COALESCE(license_plate, $3),
              list_price    = COALESCE(list_price, $4)
       WHERE  user_id = $1 AND code = $2
       RETURNING id`,
      [userId, fahrzeug.code, fahrzeug.license_plate ?? null, fahrzeug.list_price ?? null]
    );
    if (vorhanden.rows.length > 0) return { id: vorhanden.rows[0].id, created: false };
  }

  const bestehende = await db.query(`SELECT name, is_default FROM vehicles WHERE user_id = $1`, [userId]);
  let name = fahrzeug.name;
  if (bestehende.rows.some(r => r.name === name)) name = `${name} (wiederhergestellt)`.slice(0, 100);
  const isDefault = !bestehende.rows.some(r => r.is_default);

  let vehicle;
  const codeFrei = fahrzeug.code &&
    (await db.query(`SELECT 1 FROM vehicles WHERE code = $1`, [fahrzeug.code])).rows.length === 0;
  if (codeFrei) {
    vehicle = (await db.query(
      `INSERT INTO vehicles (user_id, name, code, is_default) VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, name, fahrzeug.code, isDefault]
    )).rows[0];
  } else {
    vehicle = await createVehicle(db, userId, name, isDefault);
  }
  await db.query(
    `UPDATE vehicles SET license_plate = $2, list_price = $3, drive_type = $4 WHERE id = $1`,
    [vehicle.id, fahrzeug.license_plate ?? null, fahrzeug.list_price ?? null, fahrzeug.drive_type ?? "combustion"]
  );
  return { id: vehicle.id, created: true };
}

// Imports annual costs, trips and audit log into a vehicle (vehicleId null = no vehicle).
// bekannteAudits: set of the user's existing audit log entries (kept up to date)
// alteVehicleId:  ID of the vehicle in the backup (for orphaned trips)
async function spieleEin(db, userId, { years: jahre = [], trips: fahrten, audit: protokoll }, vehicleId, vehicleMap, bekannteAudits, alteVehicleId = null) {
  let jahreNeu = 0;
  if (vehicleId != null) {
    for (const j of jahre) {
      const r = await db.query(
        `INSERT INTO vehicle_years (vehicle_id, year, total_costs, depreciation, commute_km, months, tax_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (vehicle_id, year) DO NOTHING`,
        [vehicleId, j.year, j.total_costs, j.depreciation, j.commute_km, j.months, j.tax_rate]
      );
      jahreNeu += r.rowCount;
    }
  }

  // Match trips (timestamp + odometer reading) across all of the user's vehicles:
  // existing → skip (even if it now belongs to a different vehicle);
  // without vehicle (vehicle was deleted) → reassign
  const vorhanden = await db.query(
    `SELECT id, timestamp, odometer_km, vehicle_id FROM trips WHERE user_id = $1`,
    [userId]
  );
  const bekannt = new Map(vorhanden.rows.map(f => [`${f.timestamp.toISOString()}|${f.odometer_km}`, f]));

  const neu = [];
  const uebersprungen = new Set();
  const zuordnen = [];
  for (const f of fahrten) {
    const key = `${f.timestamp}|${f.odometer_km}`;
    const treffer = bekannt.get(key);
    if (treffer) {
      uebersprungen.add(f.id);
      if (vehicleId != null && treffer.vehicle_id == null) {
        zuordnen.push(treffer.id);
        treffer.vehicle_id = vehicleId;
      }
      continue;
    }
    bekannt.set(key, { vehicle_id: vehicleId });
    neu.push(f);
  }

  if (zuordnen.length > 0) {
    await db.query(`UPDATE trips SET vehicle_id = $1 WHERE id = ANY($2::int[])`, [vehicleId, zuordnen]);
    // Audit log of these trips points to the (new) vehicle again
    if (alteVehicleId != null && alteVehicleId !== vehicleId) {
      for (const spalte of ["old_data", "new_data"]) {
        await db.query(
          `UPDATE trip_audit SET ${spalte} = jsonb_set(${spalte}, '{vehicle_id}', to_jsonb($1::int))
           WHERE  user_id = $2 AND trip_id = ANY($3::int[]) AND (${spalte}->>'vehicle_id')::int = $4`,
          [vehicleId, userId, zuordnen, alteVehicleId]
        );
      }
    }
  }

  // Audit log: omit entries of skipped trips and entries that already exist
  const eintraege = protokoll.filter(e => {
    if (uebersprungen.has(e.trip_id)) return false;
    const key = auditSchluessel(e.action, e.changed_at, e.old_data, e.new_data);
    if (bekannteAudits.has(key)) return false;
    bekannteAudits.add(key);
    return true;
  });

  // IDs for new trips and for audit log entries of deleted trips
  const alteIds = [...new Set([...neu.map(f => f.id), ...eintraege.map(e => e.trip_id)])];
  const idMap   = await vergebeFahrtIds(db, userId, alteIds, protokoll);
  const ids     = neu.map(f => idMap.get(f.id));
  if (neu.length > 0) {
    await db.query(
      `INSERT INTO trips (id, user_id, vehicle_id, odometer_km, destination, trip_type, timestamp)
       SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::text[], $6::text[], $7::timestamptz[])`,
      [ids, neu.map(() => userId), neu.map(() => vehicleId), neu.map(f => f.odometer_km),
       neu.map(f => f.destination), neu.map(f => f.trip_type), neu.map(f => f.timestamp)]
    );
  }

  if (eintraege.length > 0) {
    await db.query(
      `INSERT INTO trip_audit (trip_id, user_id, action, old_data, new_data, source, changed_at)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::jsonb[], $5::jsonb[], $6::text[], $7::timestamptz[])`,
      [eintraege.map(e => idMap.get(e.trip_id)), eintraege.map(() => userId), eintraege.map(e => e.action),
       eintraege.map(e => e.old_data && JSON.stringify(mappeAuditDaten(e.old_data, vehicleMap))),
       eintraege.map(e => e.new_data && JSON.stringify(mappeAuditDaten(e.new_data, vehicleMap))),
       eintraege.map(e => e.source), eintraege.map(e => e.changed_at)]
    );
  }

  return {
    trips: neu.length, reassigned: zuordnen.length, skipped: uebersprungen.size - zuordnen.length,
    years: jahreNeu, audit: eintraege.length,
  };
}

async function bekannteAuditSchluessel(db, userId) {
  const result = await db.query(
    `SELECT action, changed_at, old_data, new_data FROM trip_audit WHERE user_id = $1`,
    [userId]
  );
  return new Set(result.rows.map(e => auditSchluessel(e.action, e.changed_at, e.old_data, e.new_data)));
}

// Restore a single backup (format v2) (db: client within a transaction)
export async function stelleFahrzeugWiederHer(db, userId, daten) {
  const ziel = await zielFahrzeug(db, userId, daten.vehicle);
  const vehicleMap = new Map(daten.vehicle.id != null ? [[daten.vehicle.id, ziel.id]] : []);
  const ergebnis = await spieleEin(db, userId, daten, ziel.id, vehicleMap, await bekannteAuditSchluessel(db, userId), daten.vehicle.id ?? null);
  return { vehicle_id: ziel.id, created: ziel.created, ...ergebnis };
}

// Restore a full backup (db: client within a transaction)
export async function stelleAllesWiederHer(db, userId, sicherung) {
  // Map all vehicles first so reassignments in the audit log are represented correctly
  const ziele = [];
  const vehicleMap = new Map();
  for (const f of sicherung.vehicles) {
    const ziel = await zielFahrzeug(db, userId, f.vehicle);
    ziele.push(ziel);
    if (f.vehicle.id != null) vehicleMap.set(f.vehicle.id, ziel.id);
  }

  const bekannteAudits = await bekannteAuditSchluessel(db, userId);
  const fahrzeuge = [];
  for (const [i, f] of sicherung.vehicles.entries()) {
    const ergebnis = await spieleEin(db, userId, f, ziele[i].id, vehicleMap, bekannteAudits, f.vehicle.id ?? null);
    fahrzeuge.push({ vehicle_id: ziele[i].id, name: f.vehicle.name, created: ziele[i].created, ...ergebnis });
  }
  const ohneFahrzeug = await spieleEin(db, userId, sicherung.unassigned, null, vehicleMap, bekannteAudits);

  return { vehicles: fahrzeuge, unassigned: ohneFahrzeug };
}

// ── Reminder ─────────────────────────────────────────────────

export const ERINNERUNG_TAGE = 30;

// Per vehicle: last backup and changes since then. Remind if there are
// changes and the last backup (or the creation) was more than
// ERINNERUNG_TAGE ago.
export async function sicherungsStatus(db, userId) {
  const result = await db.query(
    `SELECT v.id, v.name, v.code, v.last_backup_at,
            (SELECT COUNT(*)::int FROM trip_audit a
             WHERE  a.user_id = v.user_id
               AND  a.changed_at > COALESCE(v.last_backup_at, '-infinity')
               AND  v.id IN ((a.old_data->>'vehicle_id')::int, (a.new_data->>'vehicle_id')::int)) AS changes,
            COALESCE(v.last_backup_at, v.created_at) < NOW() - make_interval(days => $2) AS faellig
     FROM   vehicles v
     WHERE  v.user_id = $1
     ORDER  BY v.is_default DESC, v.id`,
    [userId, ERINNERUNG_TAGE]
  );
  const vehicles = result.rows.map(({ faellig, ...v }) => ({ ...v, remind: faellig && v.changes > 0 }));
  return { reminder_days: ERINNERUNG_TAGE, remind: vehicles.some(v => v.remind), vehicles };
}
