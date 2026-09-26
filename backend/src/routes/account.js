// ============================================================
// Own account: profile, password, vehicles, API tokens
// ============================================================

import express from "express";
import bcrypt  from "bcrypt";
import { asyncHandler, HttpError, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { createApiToken } from "../lib/tokens.js";
import { createVehicle } from "../lib/vehicles.js";
import { TRIP_COLUMNS, writeAudit } from "../lib/trips.js";
import { changePasswordBody, idParam, profileUpdateBody, tokenBody, vehicleBody, vehicleDeleteQuery } from "../schemas.js";

export function accountRoutes({ pool, requireAuth }) {
  const router = express.Router();

  const listTokens = userId => pool.query(
    `SELECT id, label, is_default, created_at FROM api_tokens
     WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC`,
    [userId]
  );
  const listVehicles = userId => pool.query(
    `SELECT id, name, code, is_default, created_at, license_plate,
            list_price::float8 AS list_price, drive_type
     FROM vehicles
     WHERE user_id = $1 ORDER BY is_default DESC, id ASC`,
    [userId]
  );

  // ── Profile ────────────────────────────────────────────────

  // GET /api/profile  →  user info + own tokens + own vehicles
  router.get("/profile", requireAuth, asyncHandler(async (req, res) => {
    const [userRes, tokenRes, vehicleRes] = await Promise.all([
      pool.query(`SELECT id, username, role, country, language, created_at FROM users WHERE id = $1`, [req.userId]),
      listTokens(req.userId),
      listVehicles(req.userId),
    ]);

    if (userRes.rows.length === 0) {
      throw new HttpError(404, "errors.userNotFound");
    }

    return res.json({ user: userRes.rows[0], tokens: tokenRes.rows, vehicles: vehicleRes.rows });
  }));

  // PATCH /api/profile  →  change own settings
  // Body: { language: "de" | "en" | null }  (null = automatic)
  router.patch("/profile", requireAuth, asyncHandler(async (req, res) => {
    const { language } = parse(profileUpdateBody, req.body);
    await pool.query(`UPDATE users SET language = $1 WHERE id = $2`, [language, req.userId]);
    return res.json({ message: req.t("messages.profileSaved"), language });
  }));

  // POST /api/users/change-password  →  change own password
  router.post("/users/change-password", requireAuth, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordBody, req.body);

    const result = await pool.query(`SELECT password FROM users WHERE id = $1`, [req.userId]);
    const valid  = result.rows[0] && await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      throw new HttpError(401, "errors.wrongCurrentPassword");
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, req.userId]);

    return res.json({ message: req.t("messages.passwordChanged") });
  }));

  // ── Vehicles ───────────────────────────────────────────────

  router.get("/vehicles", requireAuth, asyncHandler(async (req, res) => {
    return res.json((await listVehicles(req.userId)).rows);
  }));

  // POST /api/vehicles  →  create a new vehicle; code is generated
  // Body: { name, is_default? }
  router.post("/vehicles", requireAuth, asyncHandler(async (req, res) => {
    const { name, is_default } = parse(vehicleBody, req.body);

    const created = await withTransaction(pool, async client => {
      // If the new vehicle should be the default → clear the old default
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

  // PATCH /api/vehicles/:id/default  →  mark this vehicle as default
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
        throw new HttpError(404, "errors.vehicleNotFound");
      }
      return result.rows[0];
    });

    return res.json(updated);
  }));

  // DELETE /api/vehicles/:id[?target=ID]  →  delete vehicle
  // If it has trips, they must first move to another vehicle of the user (target)
  // – otherwise they would vanish from all views and the logbook PDF.
  // Without target the endpoint then responds with 409 (code HAS_TRIPS, count).
  router.delete("/vehicles/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { target } = parse(vehicleDeleteQuery, req.query);

    const shifted = await withTransaction(pool, async client => {
      const vehicle = (await client.query(
        `SELECT id FROM vehicles WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, req.userId]
      )).rows[0];
      if (!vehicle) {
        throw new HttpError(404, "errors.vehicleNotFound");
      }

      const trips = (await client.query(
        `SELECT ${TRIP_COLUMNS} FROM trips
         WHERE user_id = $1 AND vehicle_id = $2 FOR UPDATE`,
        [req.userId, id]
      )).rows;

      if (trips.length > 0) {
        if (target === undefined) {
          throw new HttpError(409, "errors.vehicleHasTrips",
            { code: "HAS_TRIPS", count: trips.length }, { count: trips.length });
        }
        const targetOk = target !== id && (await client.query(
          `SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2`, [target, req.userId]
        )).rows.length > 0;
        if (!targetOk) {
          throw new HttpError(400, "errors.invalidTargetVehicle");
        }
        for (const old of trips) {
          const newValue = (await client.query(
            `UPDATE trips SET vehicle_id = $1 WHERE id = $2
             RETURNING ${TRIP_COLUMNS}`,
            [target, old.id]
          )).rows[0];
          await writeAudit(client, {
            tripId: old.id, userId: req.userId, action: "update",
            oldRow: old, newRow: newValue, source: req.authSource,
          });
        }
      }

      await client.query(`DELETE FROM vehicles WHERE id = $1`, [id]);
      return trips.length;
    });

    return res.json({ message: req.t("messages.vehicleDeleted"), moved: shifted });
  }));

  // ── API-Tokens ─────────────────────────────────────────────

  // GET /api/tokens  →  all tokens of the user (without the token value itself)
  router.get("/tokens", requireAuth, asyncHandler(async (req, res) => {
    return res.json((await listTokens(req.userId)).rows);
  }));

  // POST /api/tokens  →  generate a new token; plain text only in this response
  // Body: { label?, is_default? }
  router.post("/tokens", requireAuth, asyncHandler(async (req, res) => {
    const { label, is_default } = parse(tokenBody, req.body);

    const created = await withTransaction(pool, async client => {
      // If the new token should be the default → clear the old default
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
      throw new HttpError(404, "errors.tokenNotFound");
    }
    return res.json({ message: req.t("messages.tokenDeleted") });
  }));

  return router;
}
