// ============================================================
// Auto-Info: Fahrzeugdaten, Kennzahlen, Jahreskosten und
// Vergleich 1-%-Regel ↔ Fahrtenbuch
// ============================================================

import express from "express";
import { asyncHandler, HttpError, parse } from "../http.js";
import { steuerVergleich } from "../lib/steuer.js";
import { fasseZusammen, jahresFahrten } from "../lib/strecken.js";
import { pruefeJahr } from "../lib/pruefung.js";
import { idParam, infoQuery, vehicleUpdateBody, vehicleYearBody, vehicleYearParam } from "../schemas.js";

const VEHICLE_FIELDS = `id, name, code, is_default, created_at, license_plate,
                        list_price::float8 AS list_price, drive_type`;

export function vehicleRoutes({ pool, config, requireAuth }) {
  const router = express.Router();
  const tz = config.timezone;

  async function eigenesFahrzeug(id, userId) {
    const result = await pool.query(
      `SELECT ${VEHICLE_FIELDS} FROM vehicles WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (result.rows.length === 0) {
      throw new HttpError(404, "Fahrzeug nicht gefunden oder keine Berechtigung");
    }
    return result.rows[0];
  }

  // PATCH /api/vehicles/:id  →  Name, Kennzeichen, Listenpreis, Antrieb ändern
  router.patch("/vehicles/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const changes = parse(vehicleUpdateBody, req.body);
    const fields  = Object.keys(changes).filter(f => changes[f] !== undefined);
    if (fields.length === 0) {
      throw new HttpError(400, "Keine Felder zum Aktualisieren angegeben");
    }

    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
    const result = await pool.query(
      `UPDATE vehicles SET ${setClause}
       WHERE  id = $${fields.length + 1} AND user_id = $${fields.length + 2}
       RETURNING ${VEHICLE_FIELDS}`,
      [...fields.map(f => changes[f]), id, req.userId]
    );
    if (result.rows.length === 0) {
      throw new HttpError(404, "Fahrzeug nicht gefunden oder keine Berechtigung");
    }
    return res.json(result.rows[0]);
  }));

  // GET /api/vehicles/:id/info?year=YYYY  →  Fahrzeug, Kennzahlen, Kosten, Vergleich
  router.get("/vehicles/:id/info", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const year = parse(infoQuery, req.query).year
      ?? Number(new Date().toLocaleString("en-CA", { timeZone: tz, year: "numeric" }));
    const vehicle = await eigenesFahrzeug(id, req.userId);

    const [gesamt, jahr, kosten] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS fahrten,
                MIN(timestamp) AS erste_fahrt,
                MAX(timestamp) AS letzte_fahrt,
                (SELECT kmstand FROM fahrten
                 WHERE user_id = $1 AND vehicle_id = $2
                 ORDER BY timestamp DESC, id DESC LIMIT 1) AS km_aktuell
         FROM   fahrten
         WHERE  user_id = $1 AND vehicle_id = $2`,
        [req.userId, id]
      ),
      jahresFahrten(pool, { userId: req.userId, year, vehicleId: id, timezone: tz }),
      pool.query(
        `SELECT total_costs::float8 AS total_costs, depreciation::float8 AS depreciation,
                commute_km::float8 AS commute_km, months, tax_rate::float8 AS tax_rate, updated_at
         FROM   vehicle_years WHERE vehicle_id = $1 AND year = $2`,
        [id, year]
      ),
    ]);

    const km = fasseZusammen(jahr).summe;
    return res.json({
      vehicle,
      year,
      gesamt:    gesamt.rows[0],
      jahr:      km,
      kosten:    kosten.rows[0] ?? null,
      vergleich: steuerVergleich(vehicle, kosten.rows[0] ?? null, km),
    });
  }));

  // GET /api/vehicles/:id/pruefung?year=YYYY  →  Ampel + Auffälligkeiten eines Jahres
  router.get("/vehicles/:id/pruefung", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const year = parse(infoQuery, req.query).year
      ?? Number(new Date().toLocaleString("en-CA", { timeZone: tz, year: "numeric" }));
    await eigenesFahrzeug(id, req.userId);

    const [fahrten, audit, ohneFahrzeug] = await Promise.all([
      jahresFahrten(pool, { userId: req.userId, year, vehicleId: id, timezone: tz }),
      pool.query(
        `SELECT COUNT(DISTINCT fahrt_id) FILTER (WHERE action = 'update')::int AS geaendert,
                COUNT(DISTINCT fahrt_id) FILTER (WHERE action = 'delete')::int AS geloescht
         FROM   fahrten_audit
         WHERE  user_id = $1
           AND  $3 IN ((old_data->>'vehicle_id')::int, (new_data->>'vehicle_id')::int)
           AND  $2 IN (
                  EXTRACT(YEAR FROM ((old_data->>'timestamp')::timestamptz AT TIME ZONE $4)),
                  EXTRACT(YEAR FROM ((new_data->>'timestamp')::timestamptz AT TIME ZONE $4))
                )`,
        [req.userId, year, id, tz]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS anzahl FROM fahrten
         WHERE  user_id = $1 AND vehicle_id IS NULL
           AND  timestamp >= make_timestamptz($2, 1, 1, 0, 0, 0, $3)
           AND  timestamp <  make_timestamptz($2 + 1, 1, 1, 0, 0, 0, $3)`,
        [req.userId, year, tz]
      ),
    ]);

    return res.json({
      year,
      ...pruefeJahr(fahrten, { ...audit.rows[0], ohneFahrzeug: ohneFahrzeug.rows[0].anzahl }),
    });
  }));

  // PUT /api/vehicles/:id/years/:year  →  Jahreskosten speichern
  router.put("/vehicles/:id/years/:year", requireAuth, asyncHandler(async (req, res) => {
    const { id, year } = parse(vehicleYearParam, req.params);
    const k = parse(vehicleYearBody, req.body);
    await eigenesFahrzeug(id, req.userId);

    await pool.query(
      `INSERT INTO vehicle_years (vehicle_id, year, total_costs, depreciation, commute_km, months, tax_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (vehicle_id, year) DO UPDATE
       SET total_costs = EXCLUDED.total_costs, depreciation = EXCLUDED.depreciation,
           commute_km  = EXCLUDED.commute_km,  months       = EXCLUDED.months,
           tax_rate    = EXCLUDED.tax_rate,    updated_at   = NOW()`,
      [id, year, k.total_costs, k.depreciation, k.commute_km, k.months, k.tax_rate]
    );
    return res.json({ message: "Kosten gespeichert" });
  }));

  return router;
}
