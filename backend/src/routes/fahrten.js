// ============================================================
// Fahrten: Anlegen, Bearbeiten, Löschen, Änderungsprotokoll
// ============================================================

import express from "express";
import { asyncHandler, HttpError, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { checkKmPlausibility, writeAudit } from "../lib/fahrten.js";
import { fasseZusammen, jahresFahrten } from "../lib/strecken.js";
import { vehicleIdByCode } from "../lib/vehicles.js";
import { COL, TAB, auditZeileAusDb, fahrtSpalten, fahrtartZuDb } from "../lib/dbschema.js";
import { auditQuery, fahrtCreate, fahrtUpdate, idParam, yearQuery } from "../schemas.js";

// Fahrt mit API-Namen und -Werten (für Antworten und das Änderungsprotokoll)
const RETURNING = fahrtSpalten();

// API-Feld → Datenbankspalte (Werte von fahrtart werden zusätzlich übersetzt)
const SPALTE = { kmstand: COL.kmstand, ziel: COL.ziel, fahrtart: COL.fahrtart, timestamp: "timestamp", vehicle_id: "vehicle_id" };
const zuDb = (feld, wert) => (feld === "fahrtart" ? fahrtartZuDb(wert) : wert);

export function fahrtenRoutes({ pool, config, requireAuth, geocode }) {
  const router = express.Router();

  // Löst einen vehicle_code zur internen vehicle_id auf.
  // code === undefined → nicht angegeben: Default-Fahrzeug des Users (oder null, falls keins)
  // code === null      → explizit kein Fahrzeug
  // code === "ABC123"  → muss ein Fahrzeug des Users sein
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

  // POST /api/fahrt  →  Neue Fahrt speichern
  // Body: { kmstand, ziel, fahrtart, timestamp, vehicle_code?, force? }
  // Ohne vehicle_code wird das Default-Fahrzeug des Users verwendet (falls vorhanden).
  router.post("/fahrt", requireAuth, asyncHandler(async (req, res) => {
    const { force, vehicle_code, ...fahrt } = parse(fahrtCreate, req.body);
    fahrt.vehicle_id = await resolveVehicleId(vehicle_code, req.userId);

    fahrt.ziel = await geocode(fahrt.ziel);

    const row = await withTransaction(pool, async client => {
      await checkKmPlausibility(client, req.userId, fahrt, force);

      const inserted = (await client.query(
        `INSERT INTO ${TAB.fahrten} (user_id, vehicle_id, ${COL.kmstand}, ${COL.ziel}, ${COL.fahrtart}, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${RETURNING}`,
        [req.userId, fahrt.vehicle_id ?? null, fahrt.kmstand, fahrt.ziel, fahrtartZuDb(fahrt.fahrtart), fahrt.timestamp]
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
  // Body: beliebige Teilmenge von { kmstand, ziel, fahrtart, timestamp, vehicle_code }, optional force
  // Ein neuer timestamp verschiebt die Fahrt ggf. in einen anderen Monat.
  router.put("/fahrt/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { force, ...changes } = parse(fahrtUpdate, req.body);

    if ("vehicle_code" in changes) {
      changes.vehicle_id = await resolveVehicleId(changes.vehicle_code, req.userId);
      delete changes.vehicle_code;
    }

    const fields = Object.keys(changes);  // nur Felder aus dem Schema
    if (fields.length === 0) {
      throw new HttpError(400, "Keine Felder zum Aktualisieren angegeben");
    }

    if (changes.ziel !== undefined) {
      changes.ziel = await geocode(changes.ziel);
    }

    const updated = await withTransaction(pool, async client => {
      const old = (await client.query(
        `SELECT ${RETURNING} FROM ${TAB.fahrten} WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, req.userId]
      )).rows[0];
      if (!old) {
        throw new HttpError(404, "Fahrt nicht gefunden");
      }

      if (["kmstand", "timestamp", "vehicle_id"].some(f => f in changes)) {
        await checkKmPlausibility(client, req.userId, { ...old, ...changes, id }, force);
      }

      const setClause = fields.map((f, i) => `${SPALTE[f]} = $${i + 1}`).join(", ");
      const row = (await client.query(
        `UPDATE ${TAB.fahrten}
         SET    ${setClause}
         WHERE  id = $${fields.length + 1} AND user_id = $${fields.length + 2}
         RETURNING ${RETURNING},
                   TO_CHAR(timestamp AT TIME ZONE $${fields.length + 3}, 'YYYY-MM') AS month`,
        [...fields.map(f => zuDb(f, changes[f])), id, req.userId, config.timezone]
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
        `DELETE FROM ${TAB.fahrten} WHERE id = $1 AND user_id = $2 RETURNING ${RETURNING}`,
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
       FROM   ${TAB.audit}
       WHERE  ${COL.fahrtId} = $1 AND user_id = $2
       ORDER  BY changed_at ASC, id ASC`,
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      throw new HttpError(404, "Keine Protokolleinträge für diese Fahrt");
    }
    return res.json(result.rows.map(auditZeileAusDb));
  }));

  // GET /api/fahrten?year=YYYY[&vehicle=CODE]  →  Fahrten eines Jahres mit Strecken,
  // Monatsübersicht und Jahressumme (eine Abfrage statt zwölf Monatsexporte)
  router.get("/fahrten", requireAuth, asyncHandler(async (req, res) => {
    const { year, vehicle } = parse(yearQuery, req.query);
    const vehicleId = await vehicleIdByCode(pool, req.userId, vehicle);
    const fahrten = await jahresFahrten(pool, { userId: req.userId, year, vehicleId, timezone: config.timezone });

    return res.json({
      year,
      ...fasseZusammen(fahrten),
      fahrten: fahrten.map(f => ({
        _id:          f.id,          // wie /api/export/json
        kmstand:      f.kmstand,
        strecke:      f.strecke,
        ziel:         f.ziel,
        fahrtart:     f.fahrtart,
        timestamp:    f.timestamp,
        monat:        f.monat,
        vehicle_id:   f.vehicle_id,
        vehicle_name: f.vehicle_name,
        edited:       f.edited,
      })),
    });
  }));

  // GET /api/audit?year=YYYY[&vehicle=CODE]  →  Änderungen und Löschungen an Fahrten eines Jahres
  router.get("/audit", requireAuth, asyncHandler(async (req, res) => {
    const { year, vehicle } = parse(auditQuery, req.query);
    const vehicleId = await vehicleIdByCode(pool, req.userId, vehicle);
    const result = await pool.query(
      `SELECT ${COL.fahrtId}, action, old_data, new_data, source, changed_at
       FROM   ${TAB.audit}
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
    return res.json(result.rows.map(auditZeileAusDb));
  }));

  return router;
}
