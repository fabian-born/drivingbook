// ============================================================
// Export: JSON (Monat), CSV und PDF (Jahr)
// ============================================================

import express from "express";
import { asyncHandler, HttpError, parse } from "../http.js";
import { csvField } from "../lib/csv.js";
import { renderYearPdf } from "../lib/pdf.js";
import { vehicleIdByCode } from "../lib/vehicles.js";
import { jahresFahrten } from "../lib/strecken.js";
import { monthQuery, vehicleQuery, yearParam } from "../schemas.js";

export function exportRoutes({ pool, config, requireAuth }) {
  const router = express.Router();
  const tz = config.timezone;

  // Alle Exporte akzeptieren ?vehicle=CODE; vehicleId === null → alle Fahrzeuge
  const yearTrips = (userId, year, vehicleId) => pool.query(
    `SELECT f.id, f.kmstand, f.ziel, f.fahrtart, f.timestamp, f.vehicle_id,
            v.name AS vehicle_name,
            TO_CHAR(f.timestamp AT TIME ZONE $3, 'DD.MM.YYYY HH24:MI') AS zeitpunkt,
            EXISTS (SELECT 1 FROM fahrten_audit a
                    WHERE a.fahrt_id = f.id AND a.action = 'update') AS edited
     FROM   fahrten f
     LEFT JOIN vehicles v ON v.id = f.vehicle_id
     WHERE  f.user_id = $1
       AND  f.timestamp >= make_timestamptz($2, 1, 1, 0, 0, 0, $3)
       AND  f.timestamp <  make_timestamptz($2 + 1, 1, 1, 0, 0, 0, $3)
       AND  ($4::int IS NULL OR f.vehicle_id = $4)
     ORDER  BY f.timestamp ASC, f.id ASC`,
    [userId, year, tz, vehicleId]
  );

  // GET /api/export/json?month=YYYY-MM[&vehicle=CODE]  →  Fahrten eines Monats
  router.get("/export/json", requireAuth, asyncHandler(async (req, res) => {
    const { month, vehicle } = parse(monthQuery, req.query);
    const vehicleId = await vehicleIdByCode(pool, req.userId, vehicle);

    const result = await pool.query(
      `SELECT f.id, f.kmstand, f.ziel, f.fahrtart, f.timestamp, f.vehicle_id,
              v.name AS vehicle_name,
              EXISTS (SELECT 1 FROM fahrten_audit a
                      WHERE a.fahrt_id = f.id AND a.action = 'update') AS edited
       FROM   fahrten f
       LEFT JOIN vehicles v ON v.id = f.vehicle_id
       WHERE  f.user_id = $1
         AND  TO_CHAR(f.timestamp AT TIME ZONE $3, 'YYYY-MM') = $2
         AND  ($4::int IS NULL OR f.vehicle_id = $4)
       ORDER  BY f.timestamp ASC, f.id ASC`,
      [req.userId, month, tz, vehicleId]
    );

    // Das Frontend erkennt Monate ohne Fahrten am 404
    if (result.rows.length === 0) {
      throw new HttpError(404, "Keine Daten für diesen Monat");
    }

    return res.json(result.rows.map(r => ({
      _id:          r.id,         // wird für PUT/DELETE gebraucht
      kmstand:      r.kmstand,
      ziel:         r.ziel,
      fahrtart:     r.fahrtart,
      timestamp:    r.timestamp,
      vehicle_id:   r.vehicle_id,
      vehicle_name: r.vehicle_name,
      edited:       r.edited,     // nachträglich geändert (siehe Änderungsprotokoll)
    })));
  }));

  // GET /api/export/csv/year/:year
  router.get("/export/csv/year/:year", requireAuth, asyncHandler(async (req, res) => {
    const { year } = parse(yearParam, req.params);
    const { vehicle } = parse(vehicleQuery, req.query);
    const result = await yearTrips(req.userId, year, await vehicleIdByCode(pool, req.userId, vehicle));

    let csv = "KM Stand;Ziel;Fahrtart;Zeitpunkt;Fahrzeug;Nachträglich geändert\n";
    for (const f of result.rows) {
      csv += [
        f.kmstand, csvField(f.ziel), f.fahrtart, f.zeitpunkt, csvField(f.vehicle_name), f.edited ? "ja" : "nein",
      ].join(";") + "\n";
    }

    res.header("Content-Type", "text/csv; charset=utf-8");
    res.attachment(`fahrten_${year}.csv`);
    return res.send("﻿" + csv);  // BOM für Excel
  }));

  // GET /api/export/pdf/year/:year  →  Druckfertiges Fahrtenbuch eines Jahres
  router.get("/export/pdf/year/:year", requireAuth, asyncHandler(async (req, res) => {
    const { year } = parse(yearParam, req.params);
    const { vehicle } = parse(vehicleQuery, req.query);
    const vehicleId = await vehicleIdByCode(pool, req.userId, vehicle);

    const [trips, audit, user] = await Promise.all([
      // Fahrten mit Strecke – dieselbe Berechnung wie Dashboard und Auto-Info
      jahresFahrten(pool, { userId: req.userId, year, vehicleId, timezone: tz }),
      pool.query(
        `SELECT fahrt_id, action, old_data, new_data, changed_at
         FROM   fahrten_audit
         WHERE  user_id = $1
           AND  action IN ('update', 'delete')
           AND  $2 IN (
                  EXTRACT(YEAR FROM ((old_data->>'timestamp')::timestamptz AT TIME ZONE $3)),
                  EXTRACT(YEAR FROM ((new_data->>'timestamp')::timestamptz AT TIME ZONE $3))
                )
           AND  ($4::int IS NULL OR $4 IN ((old_data->>'vehicle_id')::int, (new_data->>'vehicle_id')::int))
         ORDER  BY changed_at ASC, id ASC`,
        [req.userId, year, tz, vehicleId]
      ),
      pool.query(`SELECT username FROM users WHERE id = $1`, [req.userId]),
    ]);

    res.header("Content-Type", "application/pdf");
    res.attachment(`fahrtenbuch_${year}.pdf`);
    await renderYearPdf(res, {
      year,
      username: user.rows[0]?.username ?? "",
      trips,
      audit:    audit.rows,
      timezone: tz,
    });
  }));

  return router;
}
