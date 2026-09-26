// ============================================================
// Full account backup: all vehicles incl. trips,
// annual costs and audit log
// ============================================================

import express from "express";
import { asyncHandler, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { ohneAltformat, sichereAlles, sicherungsStatus, stelleAllesWiederHer } from "../lib/sicherung.js";
import { backupBody } from "../schemas.js";

export function backupRoutes({ pool, requireAuth }) {
  const router = express.Router();

  // GET /api/backup  →  full backup as a JSON file
  router.get("/backup", requireAuth, asyncHandler(async (req, res) => {
    const sicherung = await sichereAlles(pool, req.userId);
    res.attachment(`fahrtenbuch_sicherung_${sicherung.created_at.slice(0, 10)}.json`);
    return res.json(sicherung);
  }));

  // POST /api/backup/restore  →  restore a full backup (only adds; format v2 and v1)
  router.post("/backup/restore", requireAuth, express.json({ limit: "50mb" }), asyncHandler(async (req, res) => {
    const sicherung = parse(backupBody, ohneAltformat(req.body));
    const ergebnis  = await withTransaction(pool, client => stelleAllesWiederHer(client, req.userId, sicherung));
    const fahrten   = ergebnis.vehicles.reduce((n, f) => n + f.trips, ergebnis.unassigned.trips);
    console.log(`📥 Gesamtwiederherstellung für User ${req.userId}: ${fahrten} Fahrten`);
    return res.json(ergebnis);
  }));

  // GET /api/backup/status  →  last backup per vehicle + reminder
  router.get("/backup/status", requireAuth, asyncHandler(async (req, res) => {
    return res.json(await sicherungsStatus(pool, req.userId));
  }));

  return router;
}
