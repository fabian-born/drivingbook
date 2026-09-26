// ============================================================
// Gesamtsicherung des Kontos: alle Fahrzeuge inkl. Fahrten,
// Jahreskosten und Änderungsprotokoll
// ============================================================

import express from "express";
import { asyncHandler, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { sichereAlles, sicherungsStatus, stelleAllesWiederHer } from "../lib/sicherung.js";
import { backupBody } from "../schemas.js";
import { ausAltformat } from "../lib/altformat.js";

export function backupRoutes({ pool, requireAuth }) {
  const router = express.Router();

  // GET /api/backup  →  Gesamtsicherung als JSON-Datei
  router.get("/backup", requireAuth, asyncHandler(async (req, res) => {
    const sicherung = await sichereAlles(pool, req.userId);
    res.attachment(`fahrtenbuch_sicherung_${sicherung.created_at.slice(0, 10)}.json`);
    return res.json(sicherung);
  }));

  // POST /api/backup/restore  →  Gesamtsicherung wiederherstellen (ergänzt nur; Format v2 und v1)
  router.post("/backup/restore", requireAuth, express.json({ limit: "50mb" }), asyncHandler(async (req, res) => {
    const sicherung = parse(backupBody, ausAltformat(req.body));
    const ergebnis  = await withTransaction(pool, client => stelleAllesWiederHer(client, req.userId, sicherung));
    const fahrten   = ergebnis.vehicles.reduce((n, f) => n + f.trips, ergebnis.unassigned.trips);
    console.log(`📥 Gesamtwiederherstellung für User ${req.userId}: ${fahrten} Fahrten`);
    return res.json(ergebnis);
  }));

  // GET /api/backup/status  →  Letzte Sicherung je Fahrzeug + Erinnerung
  router.get("/backup/status", requireAuth, asyncHandler(async (req, res) => {
    return res.json(await sicherungsStatus(pool, req.userId));
  }));

  return router;
}
