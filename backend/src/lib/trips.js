// ============================================================
// Trips: odometer plausibility and audit log
// ============================================================

import { HttpError } from "../http.js";

// Fields recorded in the audit log
export const AUDIT_FIELDS = ["odometer_km", "destination", "trip_type", "timestamp", "vehicle_id"];

// Columns of a trip (for SELECT/RETURNING)
export const TRIP_COLUMNS = "id, odometer_km, destination, trip_type, timestamp, vehicle_id";

function snapshot(row) {
  if (!row) return null;
  const data = {};
  for (const field of AUDIT_FIELDS) {
    data[field] = row[field] instanceof Date ? row[field].toISOString() : row[field];
  }
  return data;
}

// Writes an entry to the audit log (db: client within a transaction)
export async function writeAudit(db, { tripId, userId, action, oldRow, newRow, source }) {
  await db.query(
    `INSERT INTO trip_audit (trip_id, user_id, action, old_data, new_data, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tripId, userId, action, snapshot(oldRow), snapshot(newRow), source]
  );
}

// Checks whether the odometer reading fits the chronologically adjacent trips
// of the same vehicle. Throws 409 unless `force` is set.
// trip: { id?, odometer_km, timestamp, vehicle_id }
export async function checkKmPlausibility(db, userId, trip, force) {
  if (force) return;

  const params = [userId, trip.vehicle_id ?? null, trip.timestamp, trip.id ?? 0];
  const [prev, next] = await Promise.all([
    db.query(
      `SELECT odometer_km, timestamp FROM trips
       WHERE  user_id = $1 AND vehicle_id IS NOT DISTINCT FROM $2
         AND  timestamp < $3 AND id <> $4
       ORDER  BY timestamp DESC LIMIT 1`,
      params
    ),
    db.query(
      `SELECT odometer_km, timestamp FROM trips
       WHERE  user_id = $1 AND vehicle_id IS NOT DISTINCT FROM $2
         AND  timestamp > $3 AND id <> $4
       ORDER  BY timestamp ASC LIMIT 1`,
      params
    ),
  ]);

  const beforeState  = prev.rows[0];
  const afterState = next.rows[0];
  const date   = d => new Date(d).toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

  if (beforeState && trip.odometer_km < beforeState.odometer_km) {
    throw new HttpError(409,
      `km-Stand ${trip.odometer_km} ist kleiner als bei der vorherigen Fahrt ` +
      `(${beforeState.odometer_km} km am ${date(beforeState.timestamp)})`,
      { code: "KM_PLAUSIBILITY" });
  }
  if (afterState && trip.odometer_km > afterState.odometer_km) {
    throw new HttpError(409,
      `km-Stand ${trip.odometer_km} ist größer als bei der folgenden Fahrt ` +
      `(${afterState.odometer_km} km am ${date(afterState.timestamp)})`,
      { code: "KM_PLAUSIBILITY" });
  }
}
