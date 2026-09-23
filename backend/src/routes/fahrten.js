// ============================================================
// Fahrten: Anlegen, Bearbeiten, Löschen, Änderungsprotokoll
// ============================================================

import express from "express";
import { asyncHandler, HttpError, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { checkKmPlausibility, writeAudit } from "../lib/fahrten.js";
import { auditQuery, fahrtCreate, fahrtUpdate, idParam } from "../schemas.js";

const RETURNING = `id, kmstand, ziel, fahrtart, timestamp, vehicle_id`;

export function fahrtenRoutes({ pool, config, requireAuth, geocode }) {
  const router = express.Router();

  async function assertVehicleOwned(vehicleId, userId) {
    if (vehicleId == null) return;
    const result = await pool.query(
      `SELECT id FROM vehicles WHERE id = $1 AND user_id = $2`,
      [vehicleId, userId]
    );
    if (result.rows.length === 0) {
      throw new HttpError(403, "Fahrzeug nicht gefunden oder keine Berechtigung");
    }
  }

  // POST /api/fahrt  →  Neue Fahrt speichern
  // Body: { kmstand, ziel, fahrtart, timestamp, vehicle_id?, force? }
  router.post("/fahrt", requireAuth, asyncHandler(async (req, res) => {
    const { force, ...fahrt } = parse(fahrtCreate, req.body);
    await assertVehicleOwned(fahrt.vehicle_id, req.userId);

    fahrt.ziel = await geocode(fahrt.ziel);

    const row = await withTransaction(pool, async client => {
      await checkKmPlausibility(client, req.userId, fahrt, force);

      const inserted = (await client.query(
        `INSERT INTO fahrten (user_id, vehicle_id, kmstand, ziel, fahrtart, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${RETURNING}`,
        [req.userId, fahrt.vehicle_id ?? null, fahrt.kmstand, fahrt.ziel, fahrt.fahrtart, fahrt.timestamp]
      )).rows[0];

      await writeAudit(client, {
        fahrtId: inserted.id, userId: req.userId, action: "create",
        newRow: inserted, source: req.authSource,
      });
      return inserted;
    });

    console.log(`✅ Fahrt gespeichert (ID: ${row.id}, User: ${req.userId})`);
    return res.json({ message: "Fahrt gespeichert", id: row.id });
  }));

  // PUT /api/fahrt/:id  →  Fahrt bearbeiten
  // Body: beliebige Teilmenge von { kmstand, ziel, fahrtart, timestamp, vehicle_id }, optional force
  // Ein neuer timestamp verschiebt die Fahrt ggf. in einen anderen Monat.
  router.put("/fahrt/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { force, ...changes } = parse(fahrtUpdate, req.body);

    const fields = Object.keys(changes);  // nur Felder aus dem Schema
    if (fields.length === 0) {
      throw new HttpError(400, "Keine Felder zum Aktualisieren angegeben");
    }

    await assertVehicleOwned(changes.vehicle_id, req.userId);
    if (changes.ziel !== undefined) {
      changes.ziel = await geocode(changes.ziel);
    }

    const updated = await withTransaction(pool, async client => {
      const old = (await client.query(
        `SELECT ${RETURNING} FROM fahrten WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, req.userId]
      )).rows[0];
      if (!old) {
        throw new HttpError(404, "Fahrt nicht gefunden");
      }

      if (["kmstand", "timestamp", "vehicle_id"].some(f => f in changes)) {
        await checkKmPlausibility(client, req.userId, { ...old, ...changes, id }, force);
      }

      const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
      const row = (await client.query(
        `UPDATE fahrten
         SET    ${setClause}
         WHERE  id = $${fields.length + 1} AND user_id = $${fields.length + 2}
         RETURNING ${RETURNING},
                   TO_CHAR(timestamp AT TIME ZONE $${fields.length + 3}, 'YYYY-MM') AS month`,
        [...fields.map(f => changes[f]), id, req.userId, config.timezone]
      )).rows[0];

      await writeAudit(client, {
        fahrtId: id, userId: req.userId, action: "update",
        oldRow: old, newRow: row, source: req.authSource,
      });
      return row;
    });

    return res.json({ message: "Fahrt aktualisiert", fahrt: updated });
  }));

  // DELETE /api/fahrt/:id
  router.delete("/fahrt/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);

    await withTransaction(pool, async client => {
      const old = (await client.query(
        `DELETE FROM fahrten WHERE id = $1 AND user_id = $2 RETURNING ${RETURNING}`,
        [id, req.userId]
      )).rows[0];
      if (!old) {
        throw new HttpError(404, "Fahrt nicht gefunden");
      }

      await writeAudit(client, {
        fahrtId: id, userId: req.userId, action: "delete",
        oldRow: old, source: req.authSource,
      });
    });

    return res.json({ message: "Fahrt gelöscht" });
  }));

  // GET /api/fahrt/:id/history  →  Alle Protokolleinträge einer Fahrt
  router.get("/fahrt/:id/history", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const result = await pool.query(
      `SELECT action, old_data, new_data, source, changed_at
       FROM   fahrten_audit
       WHERE  fahrt_id = $1 AND user_id = $2
       ORDER  BY changed_at ASC, id ASC`,
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      throw new HttpError(404, "Keine Protokolleinträge für diese Fahrt");
    }
    return res.json(result.rows);
  }));

  // GET /api/audit?year=YYYY  →  Änderungen und Löschungen an Fahrten eines Jahres
  router.get("/audit", requireAuth, asyncHandler(async (req, res) => {
    const { year } = parse(auditQuery, req.query);
    const result = await pool.query(
      `SELECT fahrt_id, action, old_data, new_data, source, changed_at
       FROM   fahrten_audit
       WHERE  user_id = $1
         AND  action IN ('update', 'delete')
         AND  $2 IN (
                EXTRACT(YEAR FROM ((old_data->>'timestamp')::timestamptz AT TIME ZONE $3)),
                EXTRACT(YEAR FROM ((new_data->>'timestamp')::timestamptz AT TIME ZONE $3))
              )
       ORDER  BY changed_at DESC, id DESC`,
      [req.userId, year, config.timezone]
    );
    return res.json(result.rows);
  }));

  return router;
}
