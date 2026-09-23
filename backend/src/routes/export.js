// ============================================================
// Export: JSON (Monat), CSV und PDF (Jahr)
// ============================================================

import express from "express";
import { asyncHandler, HttpError, parse } from "../http.js";
import { csvField } from "../lib/csv.js";
import { renderYearPdf } from "../lib/pdf.js";
import { monthQuery, yearParam } from "../schemas.js";

export function exportRoutes({ pool, config, requireAuth }) {
  const router = express.Router();
  const tz = config.timezone;

  // Fahrten eines Jahres (in lokaler Zeitzone), chronologisch
  const yearTrips = (userId, year) => pool.query(
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
     ORDER  BY f.timestamp ASC, f.id ASC`,
    [userId, year, tz]
  );

  // GET /api/export/json?month=YYYY-MM  →  Fahrten eines Monats
  router.get("/export/json", requireAuth, asyncHandler(async (req, res) => {
    const { month } = parse(monthQuery, req.query);

    const result = await pool.query(
      `SELECT f.id, f.kmstand, f.ziel, f.fahrtart, f.timestamp, f.vehicle_id,
              v.name AS vehicle_name,
              EXISTS (SELECT 1 FROM fahrten_audit a
                      WHERE a.fahrt_id = f.id AND a.action = 'update') AS edited
       FROM   fahrten f
       LEFT JOIN vehicles v ON v.id = f.vehicle_id
       WHERE  f.user_id = $1
         AND  TO_CHAR(f.timestamp AT TIME ZONE $3, 'YYYY-MM') = $2
       ORDER  BY f.timestamp ASC, f.id ASC`,
      [req.userId, month, tz]
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
    const result = await yearTrips(req.userId, year);

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

    const [trips, before, audit, user] = await Promise.all([
      yearTrips(req.userId, year),
      // Letzter km-Stand je Fahrzeug vor Jahresbeginn (Startwert für die Strecke)
      pool.query(
        `SELECT DISTINCT ON (vehicle_id) vehicle_id, kmstand
         FROM   fahrten
         WHERE  user_id = $1 AND timestamp < make_timestamptz($2, 1, 1, 0, 0, 0, $3)
         ORDER  BY vehicle_id, timestamp DESC`,
        [req.userId, year, tz]
      ),
      pool.query(
        `SELECT fahrt_id, action, old_data, new_data, changed_at
         FROM   fahrten_audit
         WHERE  user_id = $1
           AND  action IN ('update', 'delete')
           AND  $2 IN (
                  EXTRACT(YEAR FROM ((old_data->>'timestamp')::timestamptz AT TIME ZONE $3)),
                  EXTRACT(YEAR FROM ((new_data->>'timestamp')::timestamptz AT TIME ZONE $3))
                )
         ORDER  BY changed_at ASC, id ASC`,
        [req.userId, year, tz]
      ),
      pool.query(`SELECT username FROM users WHERE id = $1`, [req.userId]),
    ]);

    const startKm = new Map(before.rows.map(r => [r.vehicle_id, r.kmstand]));

    res.header("Content-Type", "application/pdf");
    res.attachment(`fahrtenbuch_${year}.pdf`);
    await renderYearPdf(res, {
      year,
      username: user.rows[0]?.username ?? "",
      trips:    trips.rows,
      startKm,
      audit:    audit.rows,
      timezone: tz,
    });
  }));

  return router;
}
