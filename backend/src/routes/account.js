// ============================================================
// Eigenes Konto: Profil, Passwort, Fahrzeuge, API-Tokens
// ============================================================

import express from "express";
import bcrypt  from "bcrypt";
import { asyncHandler, HttpError, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { createApiToken } from "../lib/tokens.js";
import { createVehicle } from "../lib/vehicles.js";
import { changePasswordBody, idParam, tokenBody, vehicleBody } from "../schemas.js";

export function accountRoutes({ pool, requireAuth }) {
  const router = express.Router();

  const listTokens = userId => pool.query(
    `SELECT id, label, is_default, created_at FROM api_tokens
     WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC`,
    [userId]
  );
  const listVehicles = userId => pool.query(
    `SELECT id, name, code, is_default, created_at FROM vehicles
     WHERE user_id = $1 ORDER BY is_default DESC, id ASC`,
    [userId]
  );

  // ── Profil ─────────────────────────────────────────────────

  // GET /api/profile  →  Userinfos + eigene Tokens + eigene Fahrzeuge
  router.get("/profile", requireAuth, asyncHandler(async (req, res) => {
    const [userRes, tokenRes, vehicleRes] = await Promise.all([
      pool.query(`SELECT id, username, role, created_at FROM users WHERE id = $1`, [req.userId]),
      listTokens(req.userId),
      listVehicles(req.userId),
    ]);

    if (userRes.rows.length === 0) {
      throw new HttpError(404, "User nicht gefunden");
    }

    return res.json({ user: userRes.rows[0], tokens: tokenRes.rows, vehicles: vehicleRes.rows });
  }));

  // POST /api/users/change-password  →  Eigenes Passwort ändern
  router.post("/users/change-password", requireAuth, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordBody, req.body);

    const result = await pool.query(`SELECT password FROM users WHERE id = $1`, [req.userId]);
    const valid  = result.rows[0] && await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      throw new HttpError(401, "Aktuelles Passwort falsch");
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, req.userId]);

    return res.json({ message: "Passwort erfolgreich geändert" });
  }));

  // ── Fahrzeuge ──────────────────────────────────────────────

  router.get("/vehicles", requireAuth, asyncHandler(async (req, res) => {
    return res.json((await listVehicles(req.userId)).rows);
  }));

  // POST /api/vehicles  →  Neues Fahrzeug anlegen; Code wird generiert
  // Body: { name, is_default? }
  router.post("/vehicles", requireAuth, asyncHandler(async (req, res) => {
    const { name, is_default } = parse(vehicleBody, req.body);

    const created = await withTransaction(pool, async client => {
      // Wenn neues Fahrzeug Default sein soll → alten Default entfernen
      if (is_default) {
        await client.query(
          `UPDATE vehicles SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE`,
          [req.userId]
        );
      }
      return createVehicle(client, req.userId, name, is_default);
    });

    return res.status(201).json(created);
  }));

  // PATCH /api/vehicles/:id/default  →  Dieses Fahrzeug als Default markieren
  router.patch("/vehicles/:id/default", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);

    const updated = await withTransaction(pool, async client => {
      await client.query(
        `UPDATE vehicles SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE`,
        [req.userId]
      );
      const result = await client.query(
        `UPDATE vehicles SET is_default = TRUE WHERE id = $1 AND user_id = $2
         RETURNING id, name, code, is_default, created_at`,
        [id, req.userId]
      );
      if (result.rows.length === 0) {
        throw new HttpError(404, "Fahrzeug nicht gefunden oder keine Berechtigung");
      }
      return result.rows[0];
    });

    return res.json(updated);
  }));

  router.delete("/vehicles/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const result = await pool.query(
      `DELETE FROM vehicles WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      throw new HttpError(404, "Fahrzeug nicht gefunden oder keine Berechtigung");
    }
    return res.json({ message: "Fahrzeug gelöscht" });
  }));

  // ── API-Tokens ─────────────────────────────────────────────

  // GET /api/tokens  →  Alle Tokens des Users (ohne den Token-Wert selbst)
  router.get("/tokens", requireAuth, asyncHandler(async (req, res) => {
    return res.json((await listTokens(req.userId)).rows);
  }));

  // POST /api/tokens  →  Neuen Token generieren; Klartext nur in dieser Antwort
  // Body: { label?, is_default? }
  router.post("/tokens", requireAuth, asyncHandler(async (req, res) => {
    const { label, is_default } = parse(tokenBody, req.body);

    const created = await withTransaction(pool, async client => {
      // Wenn neuer Token Default sein soll → alten Default entfernen
      if (is_default) {
        await client.query(
          `UPDATE api_tokens SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE`,
          [req.userId]
        );
      }
      return createApiToken(client, req.userId, label, is_default);
    });

    return res.status(201).json(created);
  }));

  router.delete("/tokens/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const result = await pool.query(
      `DELETE FROM api_tokens WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      throw new HttpError(404, "Token nicht gefunden oder keine Berechtigung");
    }
    return res.json({ message: "Token gelöscht" });
  }));

  return router;
}
