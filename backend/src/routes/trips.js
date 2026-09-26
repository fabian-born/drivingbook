// ============================================================
// Trips: create, edit, delete, audit log
// ============================================================

import express from "express";
import { asyncHandler, HttpError, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { TRIP_COLUMNS, checkKmPlausibility, writeAudit } from "../lib/trips.js";
import { summarize, loadYearTrips } from "../lib/distances.js";
import { vehicleIdByCode } from "../lib/vehicles.js";
import { auditQuery, idParam, tripCreate, tripUpdate, yearQuery } from "../schemas.js";

export function tripRoutes({ pool, config, requireAuth, geocode }) {
  const router = express.Router();

  // Resolves a vehicle_code to the internal vehicle_id.
  // code === undefined → not given: the user's default vehicle (or null if none)
  // code === null      → explicitly no vehicle
  // code === "ABC123"  → must be one of the user's vehicles
  async function resolveVehicleId(code, userId) {
    if (code === undefined) {
      const result = await pool.query(
        `SELECT id FROM vehicles WHERE user_id = $1 AND is_default = TRUE`,
        [userId]
      );
      return result.rows[0]?.id ?? null;
    }
    if (code === null) return null;
    return vehicleIdByCode(pool, userId, code);
  }

  // Create a trip (validated input in the new format).
  // A trip that already exists identically (same timestamp to the millisecond,
  // odometer, destination, type and vehicle) is not inserted again: the offline
  // queue re-sends a trip if the page was left before the response arrived.
  async function createTrip(req, { force, vehicle_code, ...trip }) {
    trip.vehicle_id  = await resolveVehicleId(vehicle_code, req.userId);
    trip.destination = await geocode(trip.destination);

    const row = await withTransaction(pool, async client => {
      const existing = (await client.query(
        `SELECT ${TRIP_COLUMNS} FROM trips
         WHERE  user_id = $1 AND vehicle_id IS NOT DISTINCT FROM $2 AND timestamp = $3
           AND  odometer_km = $4 AND destination = $5 AND trip_type = $6
         LIMIT  1`,
        [req.userId, trip.vehicle_id ?? null, trip.timestamp, trip.odometer_km, trip.destination, trip.trip_type]
      )).rows[0];
      if (existing) return { ...existing, duplicate: true };

      await checkKmPlausibility(client, req.userId, trip, force);

      const inserted = (await client.query(
        `INSERT INTO trips (user_id, vehicle_id, odometer_km, destination, trip_type, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${TRIP_COLUMNS}`,
        [req.userId, trip.vehicle_id ?? null, trip.odometer_km, trip.destination, trip.trip_type, trip.timestamp]
      )).rows[0];

      await writeAudit(client, {
        tripId: inserted.id, userId: req.userId, action: "create",
        newRow: inserted, source: req.authSource,
      });
      return inserted;
    });

    console.log(row.duplicate
      ? `↩️ Fahrt bereits vorhanden (ID: ${row.id}, User: ${req.userId})`
      : `✅ Fahrt gespeichert (ID: ${row.id}, User: ${req.userId})`);
    return row;
  }

  // POST /api/trips  →  save a new trip
  // Body: { odometer_km, destination, trip_type, timestamp, vehicle_code?, force? }
  // Without vehicle_code the user's default vehicle is used (if any).
  router.post("/trips", requireAuth, asyncHandler(async (req, res) => {
    const row = await createTrip(req, parse(tripCreate, req.body));
    return res.json({ message: req.t("messages.tripSaved"), id: row.id });
  }));

  // PUT /api/trips/:id  →  edit a trip
  // Body: any subset of { odometer_km, destination, trip_type, timestamp, vehicle_code }, optional force
  // A new timestamp may move the trip to a different month.
  router.put("/trips/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { force, ...changes } = parse(tripUpdate, req.body);

    if ("vehicle_code" in changes) {
      changes.vehicle_id = await resolveVehicleId(changes.vehicle_code, req.userId);
      delete changes.vehicle_code;
    }

    const fields = Object.keys(changes);  // only fields from the schema (= column names)
    if (fields.length === 0) {
      throw new HttpError(400, "errors.noFields");
    }

    if (changes.destination !== undefined) {
      changes.destination = await geocode(changes.destination);
    }

    const updated = await withTransaction(pool, async client => {
      const old = (await client.query(
        `SELECT ${TRIP_COLUMNS} FROM trips WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, req.userId]
      )).rows[0];
      if (!old) {
        throw new HttpError(404, "errors.tripNotFound");
      }

      if (["odometer_km", "timestamp", "vehicle_id"].some(f => f in changes)) {
        await checkKmPlausibility(client, req.userId, { ...old, ...changes, id }, force);
      }

      const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
      const row = (await client.query(
        `UPDATE trips
         SET    ${setClause}
         WHERE  id = $${fields.length + 1} AND user_id = $${fields.length + 2}
         RETURNING ${TRIP_COLUMNS},
                   TO_CHAR(timestamp AT TIME ZONE $${fields.length + 3}, 'YYYY-MM') AS month`,
        [...fields.map(f => changes[f]), id, req.userId, config.timezone]
      )).rows[0];

      await writeAudit(client, {
        tripId: id, userId: req.userId, action: "update",
        oldRow: old, newRow: row, source: req.authSource,
      });
      return row;
    });

    return res.json({ message: req.t("messages.tripUpdated"), trip: updated });
  }));

  // DELETE /api/trips/:id
  router.delete("/trips/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);

    await withTransaction(pool, async client => {
      const old = (await client.query(
        `DELETE FROM trips WHERE id = $1 AND user_id = $2 RETURNING ${TRIP_COLUMNS}`,
        [id, req.userId]
      )).rows[0];
      if (!old) {
        throw new HttpError(404, "errors.tripNotFound");
      }

      await writeAudit(client, {
        tripId: id, userId: req.userId, action: "delete",
        oldRow: old, source: req.authSource,
      });
    });

    return res.json({ message: req.t("messages.tripDeleted") });
  }));

  // GET /api/trips/:id/history  →  all audit log entries of a trip
  router.get("/trips/:id/history", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const result = await pool.query(
      `SELECT action, old_data, new_data, source, changed_at
       FROM   trip_audit
       WHERE  trip_id = $1 AND user_id = $2
       ORDER  BY changed_at ASC, id ASC`,
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      throw new HttpError(404, "errors.noAuditEntries");
    }
    return res.json(result.rows);
  }));

  // GET /api/trips?year=YYYY[&vehicle=CODE]  →  trips of one year with distances,
  // monthly overview and yearly total
  router.get("/trips", requireAuth, asyncHandler(async (req, res) => {
    const { year, vehicle } = parse(yearQuery, req.query);
    const vehicleId = await vehicleIdByCode(pool, req.userId, vehicle);
    const trips = await loadYearTrips(pool, { userId: req.userId, year, vehicleId, timezone: config.timezone });

    return res.json({
      year,
      ...summarize(trips),
      trips: trips.map(f => ({
        id:           f.id,
        odometer_km:  f.odometer_km,
        distance:     f.distance,
        destination:  f.destination,
        trip_type:    f.trip_type,
        timestamp:    f.timestamp,
        month:        f.month,
        vehicle_id:   f.vehicle_id,
        vehicle_name: f.vehicle_name,
        edited:       f.edited,
      })),
    });
  }));

  // GET /api/audit?year=YYYY[&vehicle=CODE]  →  edits and deletions of trips in one year
  router.get("/audit", requireAuth, asyncHandler(async (req, res) => {
    const { year, vehicle } = parse(auditQuery, req.query);
    const vehicleId = await vehicleIdByCode(pool, req.userId, vehicle);
    const result = await pool.query(
      `SELECT trip_id, action, old_data, new_data, source, changed_at
       FROM   trip_audit
       WHERE  user_id = $1
         AND  action IN ('update', 'delete')
         AND  $2 IN (
                EXTRACT(YEAR FROM ((old_data->>'timestamp')::timestamptz AT TIME ZONE $3)),
                EXTRACT(YEAR FROM ((new_data->>'timestamp')::timestamptz AT TIME ZONE $3))
              )
         AND  ($4::int IS NULL OR $4 IN ((old_data->>'vehicle_id')::int, (new_data->>'vehicle_id')::int))
       ORDER  BY changed_at DESC, id DESC`,
      [req.userId, year, config.timezone, vehicleId]
    );
    return res.json(result.rows);
  }));

  return router;
}
