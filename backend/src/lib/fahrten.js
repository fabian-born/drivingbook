// ============================================================
// Fahrten: km-Plausibilität und Änderungsprotokoll
// ============================================================

import { HttpError } from "../http.js";

// Felder, die im Änderungsprotokoll festgehalten werden
export const AUDIT_FIELDS = ["odometer_km", "destination", "trip_type", "timestamp", "vehicle_id"];

// Spalten einer Fahrt (für SELECT/RETURNING)
export const TRIP_COLUMNS = "id, odometer_km, destination, trip_type, timestamp, vehicle_id";

function snapshot(row) {
  if (!row) return null;
  const data = {};
  for (const field of AUDIT_FIELDS) {
    data[field] = row[field] instanceof Date ? row[field].toISOString() : row[field];
  }
  return data;
}

// Schreibt einen Eintrag ins Änderungsprotokoll (db: Client in Transaktion)
export async function writeAudit(db, { fahrtId, userId, action, oldRow, newRow, source }) {
  await db.query(
    `INSERT INTO trip_audit (trip_id, user_id, action, old_data, new_data, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [fahrtId, userId, action, snapshot(oldRow), snapshot(newRow), source]
  );
}

// Prüft, ob der km-Stand zu den zeitlich benachbarten Fahrten desselben
// Fahrzeugs passt. Wirft 409, außer `force` ist gesetzt.
// fahrt: { id?, odometer_km, timestamp, vehicle_id }
export async function checkKmPlausibility(db, userId, fahrt, force) {
  if (force) return;

  const params = [userId, fahrt.vehicle_id ?? null, fahrt.timestamp, fahrt.id ?? 0];
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

  const vorher  = prev.rows[0];
  const nachher = next.rows[0];
  const datum   = d => new Date(d).toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

  if (vorher && fahrt.odometer_km < vorher.odometer_km) {
    throw new HttpError(409,
      `km-Stand ${fahrt.odometer_km} ist kleiner als bei der vorherigen Fahrt ` +
      `(${vorher.odometer_km} km am ${datum(vorher.timestamp)})`,
      { code: "KM_PLAUSIBILITY" });
  }
  if (nachher && fahrt.odometer_km > nachher.odometer_km) {
    throw new HttpError(409,
      `km-Stand ${fahrt.odometer_km} ist größer als bei der folgenden Fahrt ` +
      `(${nachher.odometer_km} km am ${datum(nachher.timestamp)})`,
      { code: "KM_PLAUSIBILITY" });
  }
}
