// ============================================================
// Database cleanup (admin): duplicate trips and trips without a vehicle
//
// Duplicate = same user, same vehicle, same odometer reading, same
// destination, same trip type and at most DUPLICATE_SECONDS apart
// (typically: double click or an offline trip submitted twice).
// The trip with the most change history is kept; on a tie, the oldest.
// Every action is written to the audit log with source "admin".
// ============================================================

import { writeAudit } from "./fahrten.js";

export const DUPLICATE_SECONDS = 5 * 60;

const TRIP_FIELDS = `f.id, f.user_id, u.username, f.vehicle_id, v.name AS vehicle_name,
                      f.odometer_km, f.destination, f.trip_type, f.timestamp`;

export async function findDuplicates(db) {
  const candidates = (await db.query(
    `SELECT ${TRIP_FIELDS},
            (SELECT COUNT(*)::int FROM trip_audit a WHERE a.trip_id = f.id) AS audit_entries
     FROM   trips f
     JOIN   users u ON u.id = f.user_id
     LEFT JOIN vehicles v ON v.id = f.vehicle_id
     WHERE  EXISTS (
              SELECT 1 FROM trips g
              WHERE  g.id <> f.id AND g.user_id = f.user_id
                AND  g.vehicle_id IS NOT DISTINCT FROM f.vehicle_id
                AND  g.odometer_km = f.odometer_km AND g.trip_type = f.trip_type
                AND  g.destination = f.destination
                AND  ABS(EXTRACT(EPOCH FROM g.timestamp - f.timestamp)) <= $1
            )
     ORDER  BY f.user_id, f.vehicle_id NULLS FIRST, f.odometer_km, f.trip_type, f.destination, f.timestamp, f.id`,
    [DUPLICATE_SECONDS]
  )).rows;

  // Consecutive candidates with the same key and a small time gap form a group
  const groups = [];
  let current = null;
  for (const f of candidates) {
    const key = [f.user_id, f.vehicle_id, f.odometer_km, f.trip_type, f.destination].join("|");
    const matches = current && current.key === key &&
      (f.timestamp - current.trips.at(-1).timestamp) / 1000 <= DUPLICATE_SECONDS;
    if (!matches) {
      current = { key, trips: [] };
      groups.push(current);
    }
    current.trips.push(f);
  }

  return groups
    .filter(g => g.trips.length > 1)
    .map(g => {
      const sorted = [...g.trips].sort((a, b) => b.audit_entries - a.audit_entries || a.id - b.id);
      const [keep, ...remove] = sorted;
      return {
        user_id: keep.user_id, username: keep.username,
        vehicle_id: keep.vehicle_id, vehicle_name: keep.vehicle_name,
        keep, remove,
      };
    });
}

export async function unassigned(db) {
  const result = await db.query(
    `SELECT u.id AS user_id, u.username, COUNT(*)::int AS count,
            MIN(f.timestamp) AS first, MAX(f.timestamp) AS last,
            COALESCE((SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'code', v.code, 'is_default', v.is_default)
                                      ORDER BY v.is_default DESC, v.id)
                      FROM vehicles v WHERE v.user_id = u.id), '[]') AS vehicles
     FROM   trips f
     JOIN   users u ON u.id = f.user_id
     WHERE  f.vehicle_id IS NULL
     GROUP  BY u.id, u.username
     ORDER  BY u.username`
  );
  return result.rows;
}

export async function report(db) {
  const [duplicateList, without] = await Promise.all([findDuplicates(db), unassigned(db)]);
  return {
    duplicate_seconds: DUPLICATE_SECONDS,
    duplicates: {
      groups:    duplicateList,
      to_remove: duplicateList.reduce((n, g) => n + g.remove.length, 0),
    },
    unassigned: without,
  };
}

const RETURNING = `id, odometer_km, destination, trip_type, timestamp, vehicle_id`;

// Deletes the surplus trips of all (or the given) duplicate groups.
// ids: only these trips – each must currently be detected as "remove"
// db: client within a transaction
export async function removeDuplicates(db, ids = null) {
  const toRemove = (await findDuplicates(db)).flatMap(g => g.remove.map(f => f.id));
  const selection = ids ? toRemove.filter(id => ids.includes(id)) : toRemove;

  for (const id of selection) {
    const old = (await db.query(`DELETE FROM trips WHERE id = $1 RETURNING ${RETURNING}, user_id`, [id])).rows[0];
    await writeAudit(db, { tripId: id, userId: old.user_id, action: "delete", oldRow: old, source: "admin" });
  }
  return { removed: selection.length, rejected: ids ? ids.filter(id => !selection.includes(id)) : [] };
}

// Assign a user's trips without a vehicle to one of their vehicles, or delete them
// db: client within a transaction
// action: "assign" (vehicle_id required) or "delete"
export async function handleUnassigned(db, { user_id, action, vehicle_id }) {
  const trips = (await db.query(
    `SELECT ${RETURNING} FROM trips WHERE user_id = $1 AND vehicle_id IS NULL FOR UPDATE`,
    [user_id]
  )).rows;

  for (const old of trips) {
    if (action === "assign") {
      const newValue = (await db.query(
        `UPDATE trips SET vehicle_id = $1 WHERE id = $2 RETURNING ${RETURNING}`,
        [vehicle_id, old.id]
      )).rows[0];
      await writeAudit(db, { tripId: old.id, userId: user_id, action: "update", oldRow: old, newRow: newValue, source: "admin" });
    } else {
      await db.query(`DELETE FROM trips WHERE id = $1`, [old.id]);
      await writeAudit(db, { tripId: old.id, userId: user_id, action: "delete", oldRow: old, source: "admin" });
    }
  }
  return { count: trips.length };
}
