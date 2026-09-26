// ============================================================
// Distances: a year's trips with kilometers driven
// Distance of a trip = odometer reading minus that of the previous trip
// of the same vehicle – also across the turn of the year. The first
// trip of a vehicle has no distance (null). Decreases in the
// odometer reading count as 0 in the totals.
// ============================================================

import { TRIP_TYPES } from "../schemas.js";

// Totals: number of trips, total km and km per trip type (business/private/commute)
function emptyTotals() {
  const sum = { trips: 0, total: 0 };
  for (const kind of TRIP_TYPES) sum[kind] = 0;
  return sum;
}

function addUp(sum, trip) {
  const km = Math.max(trip.distance ?? 0, 0);
  sum.trips++;
  sum.total += km;
  sum[trip.trip_type] += km;
}

// vehicleId === null → all vehicles (distances still per vehicle)
// Rows:   id, odometer_km, destination, trip_type, timestamp, vehicle_id,
//         distance, previous_timestamp, vehicle_name, month (YYYY-MM), edited
export async function loadYearTrips(db, { userId, year, vehicleId = null, timezone }) {
  const result = await db.query(
    `WITH legs AS (
       SELECT f.id, f.odometer_km, f.destination, f.trip_type, f.timestamp, f.vehicle_id,
              f.odometer_km - LAG(f.odometer_km) OVER (PARTITION BY f.vehicle_id ORDER BY f.timestamp, f.id) AS distance,
              LAG(f.timestamp) OVER (PARTITION BY f.vehicle_id ORDER BY f.timestamp, f.id) AS previous_timestamp
       FROM   trips f
       WHERE  f.user_id = $1
         AND  ($4::int IS NULL OR f.vehicle_id = $4)
         AND  f.timestamp < make_timestamptz($2 + 1, 1, 1, 0, 0, 0, $3)
     )
     SELECT s.*, v.name AS vehicle_name,
            TO_CHAR(s.timestamp AT TIME ZONE $3, 'YYYY-MM') AS month,
            EXISTS (SELECT 1 FROM trip_audit a
                    WHERE a.trip_id = s.id AND a.action = 'update') AS edited
     FROM   legs s
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     WHERE  s.timestamp >= make_timestamptz($2, 1, 1, 0, 0, 0, $3)
     ORDER  BY s.timestamp ASC, s.id ASC`,
    [userId, year, timezone, vehicleId]
  );
  return result.rows;
}

// Monthly summary + annual total from loadYearTrips(): { months, totals }
// start_km/end_km are only meaningful for a single vehicle
export function summarize(trips) {
  const months = new Map();
  const totals = emptyTotals();

  for (const f of trips) {
    if (!months.has(f.month)) {
      months.set(f.month, { month: f.month, start_km: f.odometer_km - (f.distance ?? 0), end_km: f.odometer_km, ...emptyTotals() });
    }
    const monthKey = months.get(f.month);
    monthKey.end_km = f.odometer_km;
    addUp(monthKey, f);
    addUp(totals, f);
  }
  return { months: [...months.values()], totals };
}
