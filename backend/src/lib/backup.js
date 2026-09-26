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
import { AUDIT_FIELDS } from "./trips.js";

// The backend no longer accepts files in the old v1 format – reject with a hint
export function rejectLegacyFormat(backupData) {
  if (backupData?.version === 1) {
    throw new HttpError(400, "Sicherung im alten Format v1 – bitte zuerst mit scripts/convert-backup.js umwandeln");
  }
  return backupData;
}

// Trip columns in the backup format
const BACKUP_TRIP = "id, odometer_km, destination, trip_type, timestamp";

// ── Backup ───────────────────────────────────────────────────

async function vehicleData(db, userId, vehicleId) {
  const [vehicle, years, trips, auditLog] = await Promise.all([
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
      `SELECT ${BACKUP_TRIP}
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
  return { vehicle: vehicle.rows[0], years: years.rows, trips: trips.rows, audit: auditLog.rows };
}

async function recordBackup(db, vehicleIds) {
  await db.query(`UPDATE vehicles SET last_backup_at = NOW() WHERE id = ANY($1::int[])`, [vehicleIds]);
}

export async function backupVehicle(db, userId, vehicleId) {
  const backupData = await vehicleData(db, userId, vehicleId);
  if (!backupData) return null;
  await recordBackup(db, [vehicleId]);
  return { format: VEHICLE_BACKUP_FORMAT, version: BACKUP_VERSION, created_at: new Date().toISOString(), ...backupData };
}

export async function backupAll(db, userId) {
  const vehicles = (await db.query(`SELECT id FROM vehicles WHERE user_id = $1 ORDER BY id`, [userId])).rows;
  const vehicleBackups = [];
  for (const v of vehicles) vehicleBackups.push(await vehicleData(db, userId, v.id));

  const [trips, auditLog] = await Promise.all([
    db.query(
      `SELECT ${BACKUP_TRIP}
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

  await recordBackup(db, vehicles.map(v => v.id));
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, created_at: new Date().toISOString(),
    vehicles:   vehicleBackups,
    unassigned: { trips: trips.rows, audit: auditLog.rows },
  };
}

// ── Restore ──────────────────────────────────────────────────

// Identifies the same audit log entry
function auditKey(action, changedAt, oldData, newData) {
  const d = oldData ?? newData ?? {};
  return `${action}|${new Date(changedAt).toISOString()}|${d.timestamp ? new Date(d.timestamp).toISOString() : ""}|${d.odometer_km ?? ""}`;
}

// Reserves n new trip IDs from the sequence of the trips table
async function newTripIds(db, n) {
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
async function assignTripIds(db, userId, oldIds, auditLog) {
  const idMap = new Map();
  if (oldIds.length === 0) return idMap;

  const state = Number((await db.query(`SELECT last_value, is_called FROM trips_id_seq`)).rows
    .map(r => (r.is_called ? r.last_value : Number(r.last_value) - 1))[0]);
  const candidates = oldIds.filter(id => id > 0 && id <= state);

  const [taken, audits] = await Promise.all([
    db.query(`SELECT id FROM trips WHERE id = ANY($1::int[])`, [candidates]),
    db.query(
      `SELECT trip_id, user_id, action, changed_at, old_data, new_data
       FROM trip_audit WHERE trip_id = ANY($1::int[])`,
      [candidates]
    ),
  ]);
  const takenIds = new Set(taken.rows.map(r => r.id));

  const backupKey = new Map();
  for (const e of auditLog) {
    if (!backupKey.has(e.trip_id)) backupKey.set(e.trip_id, new Set());
    backupKey.get(e.trip_id).add(auditKey(e.action, e.changed_at, e.old_data, e.new_data));
  }
  const foreign = new Set();
  for (const a of audits.rows) {
    const matches = a.user_id === userId &&
      backupKey.get(a.trip_id)?.has(auditKey(a.action, a.changed_at, a.old_data, a.new_data));
    if (!matches) foreign.add(a.trip_id);
  }

  const reused = new Set(candidates.filter(id => !takenIds.has(id) && !foreign.has(id)));
  const rest = oldIds.filter(id => !reused.has(id));
  for (const id of reused) idMap.set(id, id);
  (await newTripIds(db, rest.length)).forEach((id, i) => idMap.set(rest[i], id));
  return idMap;
}

// Restrict audit data to the known fields, rewrite vehicle IDs
function mapAuditData(backupData, vehicleMap) {
  if (!backupData) return null;
  const outcome = {};
  for (const fieldName of AUDIT_FIELDS) {
    if (!(fieldName in backupData)) continue;
    outcome[fieldName] = fieldName === "vehicle_id"
      ? (vehicleMap.get(backupData.vehicle_id) ?? null)
      : backupData[fieldName];
  }
  return outcome;
}

// User's vehicle with the same code – otherwise create it (name and code kept if available).
// For an existing vehicle, only empty fields are filled in.
async function targetVehicle(db, userId, savedVehicle) {
  if (savedVehicle.code) {
    const present = await db.query(
      `UPDATE vehicles
       SET    license_plate = COALESCE(license_plate, $3),
              list_price    = COALESCE(list_price, $4)
       WHERE  user_id = $1 AND code = $2
       RETURNING id`,
      [userId, savedVehicle.code, savedVehicle.license_plate ?? null, savedVehicle.list_price ?? null]
    );
    if (present.rows.length > 0) return { id: present.rows[0].id, created: false };
  }

  const existing = await db.query(`SELECT name, is_default FROM vehicles WHERE user_id = $1`, [userId]);
  let name = savedVehicle.name;
  if (existing.rows.some(r => r.name === name)) name = `${name} (wiederhergestellt)`.slice(0, 100);
  const isDefault = !existing.rows.some(r => r.is_default);

  let vehicle;
  const codeAvailable = savedVehicle.code &&
    (await db.query(`SELECT 1 FROM vehicles WHERE code = $1`, [savedVehicle.code])).rows.length === 0;
  if (codeAvailable) {
    vehicle = (await db.query(
      `INSERT INTO vehicles (user_id, name, code, is_default) VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, name, savedVehicle.code, isDefault]
    )).rows[0];
  } else {
    vehicle = await createVehicle(db, userId, name, isDefault);
  }
  await db.query(
    `UPDATE vehicles SET license_plate = $2, list_price = $3, drive_type = $4 WHERE id = $1`,
    [vehicle.id, savedVehicle.license_plate ?? null, savedVehicle.list_price ?? null, savedVehicle.drive_type ?? "combustion"]
  );
  return { id: vehicle.id, created: true };
}

// Imports annual costs, trips and audit log into a vehicle (vehicleId null = no vehicle).
// knownAudits:  set of the user's existing audit log entries (kept up to date)
// oldVehicleId: ID of the vehicle in the backup (for orphaned trips)
async function restoreInto(db, userId, { years = [], trips, audit: auditLog }, vehicleId, vehicleMap, knownAudits, oldVehicleId = null) {
  let newYears = 0;
  if (vehicleId != null) {
    for (const j of years) {
      const r = await db.query(
        `INSERT INTO vehicle_years (vehicle_id, year, total_costs, depreciation, commute_km, months, tax_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (vehicle_id, year) DO NOTHING`,
        [vehicleId, j.year, j.total_costs, j.depreciation, j.commute_km, j.months, j.tax_rate]
      );
      newYears += r.rowCount;
    }
  }

  // Match trips (timestamp + odometer reading) across all of the user's vehicles:
  // existing → skip (even if it now belongs to a different vehicle);
  // without vehicle (vehicle was deleted) → reassign
  const present = await db.query(
    `SELECT id, timestamp, odometer_km, vehicle_id FROM trips WHERE user_id = $1`,
    [userId]
  );
  const known = new Map(present.rows.map(f => [`${f.timestamp.toISOString()}|${f.odometer_km}`, f]));

  const newValue = [];
  const skippedCount = new Set();
  const assign = [];
  for (const f of trips) {
    const key = `${f.timestamp}|${f.odometer_km}`;
    const found = known.get(key);
    if (found) {
      skippedCount.add(f.id);
      if (vehicleId != null && found.vehicle_id == null) {
        assign.push(found.id);
        found.vehicle_id = vehicleId;
      }
      continue;
    }
    known.set(key, { vehicle_id: vehicleId });
    newValue.push(f);
  }

  if (assign.length > 0) {
    await db.query(`UPDATE trips SET vehicle_id = $1 WHERE id = ANY($2::int[])`, [vehicleId, assign]);
    // Audit log of these trips points to the (new) vehicle again
    if (oldVehicleId != null && oldVehicleId !== vehicleId) {
      for (const column of ["old_data", "new_data"]) {
        await db.query(
          `UPDATE trip_audit SET ${column} = jsonb_set(${column}, '{vehicle_id}', to_jsonb($1::int))
           WHERE  user_id = $2 AND trip_id = ANY($3::int[]) AND (${column}->>'vehicle_id')::int = $4`,
          [vehicleId, userId, assign, oldVehicleId]
        );
      }
    }
  }

  // Audit log: omit entries of skipped trips and entries that already exist
  const entryList = auditLog.filter(e => {
    if (skippedCount.has(e.trip_id)) return false;
    const key = auditKey(e.action, e.changed_at, e.old_data, e.new_data);
    if (knownAudits.has(key)) return false;
    knownAudits.add(key);
    return true;
  });

  // IDs for new trips and for audit log entries of deleted trips
  const oldIds = [...new Set([...newValue.map(f => f.id), ...entryList.map(e => e.trip_id)])];
  const idMap   = await assignTripIds(db, userId, oldIds, auditLog);
  const ids     = newValue.map(f => idMap.get(f.id));
  if (newValue.length > 0) {
    await db.query(
      `INSERT INTO trips (id, user_id, vehicle_id, odometer_km, destination, trip_type, timestamp)
       SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::text[], $6::text[], $7::timestamptz[])`,
      [ids, newValue.map(() => userId), newValue.map(() => vehicleId), newValue.map(f => f.odometer_km),
       newValue.map(f => f.destination), newValue.map(f => f.trip_type), newValue.map(f => f.timestamp)]
    );
  }

  if (entryList.length > 0) {
    await db.query(
      `INSERT INTO trip_audit (trip_id, user_id, action, old_data, new_data, source, changed_at)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::jsonb[], $5::jsonb[], $6::text[], $7::timestamptz[])`,
      [entryList.map(e => idMap.get(e.trip_id)), entryList.map(() => userId), entryList.map(e => e.action),
       entryList.map(e => e.old_data && JSON.stringify(mapAuditData(e.old_data, vehicleMap))),
       entryList.map(e => e.new_data && JSON.stringify(mapAuditData(e.new_data, vehicleMap))),
       entryList.map(e => e.source), entryList.map(e => e.changed_at)]
    );
  }

  return {
    trips: newValue.length, reassigned: assign.length, skipped: skippedCount.size - assign.length,
    years: newYears, audit: entryList.length,
  };
}

async function knownAuditKeys(db, userId) {
  const result = await db.query(
    `SELECT action, changed_at, old_data, new_data FROM trip_audit WHERE user_id = $1`,
    [userId]
  );
  return new Set(result.rows.map(e => auditKey(e.action, e.changed_at, e.old_data, e.new_data)));
}

// Restore a single backup (format v2) (db: client within a transaction)
export async function restoreVehicle(db, userId, backupData) {
  const target = await targetVehicle(db, userId, backupData.vehicle);
  const vehicleMap = new Map(backupData.vehicle.id != null ? [[backupData.vehicle.id, target.id]] : []);
  const outcome = await restoreInto(db, userId, backupData, target.id, vehicleMap, await knownAuditKeys(db, userId), backupData.vehicle.id ?? null);
  return { vehicle_id: target.id, created: target.created, ...outcome };
}

// Restore a full backup (db: client within a transaction)
export async function restoreAll(db, userId, backup) {
  // Map all vehicles first so reassignments in the audit log are represented correctly
  const targets = [];
  const vehicleMap = new Map();
  for (const f of backup.vehicles) {
    const target = await targetVehicle(db, userId, f.vehicle);
    targets.push(target);
    if (f.vehicle.id != null) vehicleMap.set(f.vehicle.id, target.id);
  }

  const knownAudits = await knownAuditKeys(db, userId);
  const vehicleBackups = [];
  for (const [i, f] of backup.vehicles.entries()) {
    const outcome = await restoreInto(db, userId, f, targets[i].id, vehicleMap, knownAudits, f.vehicle.id ?? null);
    vehicleBackups.push({ vehicle_id: targets[i].id, name: f.vehicle.name, created: targets[i].created, ...outcome });
  }
  const unassigned = await restoreInto(db, userId, backup.unassigned, null, vehicleMap, knownAudits);

  return { vehicles: vehicleBackups, unassigned };
}

// ── Reminder ─────────────────────────────────────────────────

export const REMINDER_DAYS = 30;

// Per vehicle: last backup and changes since then. Remind if there are
// changes and the last backup (or the creation) was more than
// REMINDER_DAYS ago.
export async function backupStatus(db, userId) {
  const result = await db.query(
    `SELECT v.id, v.name, v.code, v.last_backup_at,
            (SELECT COUNT(*)::int FROM trip_audit a
             WHERE  a.user_id = v.user_id
               AND  a.changed_at > COALESCE(v.last_backup_at, '-infinity')
               AND  v.id IN ((a.old_data->>'vehicle_id')::int, (a.new_data->>'vehicle_id')::int)) AS changes,
            COALESCE(v.last_backup_at, v.created_at) < NOW() - make_interval(days => $2) AS due
     FROM   vehicles v
     WHERE  v.user_id = $1
     ORDER  BY v.is_default DESC, v.id`,
    [userId, REMINDER_DAYS]
  );
  const vehicles = result.rows.map(({ due, ...v }) => ({ ...v, remind: due && v.changes > 0 }));
  return { reminder_days: REMINDER_DAYS, remind: vehicles.some(v => v.remind), vehicles };
}
