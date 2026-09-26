// ============================================================
// Full account backup: all vehicles incl. trips,
// annual costs and audit log
// ============================================================

import express from "express";
import { asyncHandler, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { rejectLegacyFormat, backupAll, backupStatus, restoreAll } from "../lib/backup.js";
import { backupBody } from "../schemas.js";

export function backupRoutes({ pool, requireAuth }) {
  const router = express.Router();

  // GET /api/backup  →  full backup as a JSON file
  router.get("/backup", requireAuth, asyncHandler(async (req, res) => {
    const backup = await backupAll(pool, req.userId);
    res.attachment(`fahrtenbuch_sicherung_${backup.created_at.slice(0, 10)}.json`);
    return res.json(backup);
  }));

  // POST /api/backup/restore  →  restore a full backup (only adds; format v2 and v1)
  router.post("/backup/restore", requireAuth, express.json({ limit: "50mb" }), asyncHandler(async (req, res) => {
    const backup = parse(backupBody, rejectLegacyFormat(req.body));
    const outcome  = await withTransaction(pool, client => restoreAll(client, req.userId, backup));
    const trips   = outcome.vehicles.reduce((n, f) => n + f.trips, outcome.unassigned.trips);
    console.log(`📥 Gesamtwiederherstellung für User ${req.userId}: ${trips} Fahrten`);
    return res.json(outcome);
  }));

  // GET /api/backup/status  →  last backup per vehicle + reminder
  router.get("/backup/status", requireAuth, asyncHandler(async (req, res) => {
    return res.json(await backupStatus(pool, req.userId));
  }));

  return router;
}
