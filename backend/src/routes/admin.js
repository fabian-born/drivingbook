// ============================================================
// User management (admin only)
// ============================================================

import express from "express";
import bcrypt  from "bcrypt";
import { asyncHandler, HttpError, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { createApiToken } from "../lib/tokens.js";
import { createVehicle } from "../lib/vehicles.js";
import { handleUnassigned, report, removeDuplicates } from "../lib/cleanup.js";
import { createUserBody, duplicatesBody, idParam, unassignedBody, vehicleBody } from "../schemas.js";

export function adminRoutes({ pool, requireAuth, requireAdmin }) {
  const router = express.Router();

  // GET /api/users  →  all users
  router.get("/users", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, username, role, created_at FROM users ORDER BY id ASC`
    );
    return res.json(result.rows);
  }));

  // POST /api/users  →  create a new user incl. default token
  router.post("/users", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { username, password, role } = parse(createUserBody, req.body);
    const hash = await bcrypt.hash(password, 12);

    try {
      const created = await withTransaction(pool, async client => {
        const user = (await client.query(
          `INSERT INTO users (username, password, role) VALUES ($1, $2, $3)
           RETURNING id, username, role`,
          [username, hash, role]
        )).rows[0];
        const { token } = await createApiToken(client, user.id, "Default", true);
        return { ...user, default_token: token };
      });
      return res.status(201).json(created);
    } catch (err) {
      if (err.code === "23505") throw new HttpError(409, "errors.usernameTaken");
      throw err;
    }
  }));

  // POST /api/admin/users/:id/vehicle  →  create a vehicle for another user
  router.post("/admin/users/:id/vehicle", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { name, is_default } = parse(vehicleBody, req.body);

    const userCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [id]);
    if (userCheck.rows.length === 0) {
      throw new HttpError(404, "errors.userNotFound");
    }

    const created = await withTransaction(pool, async client => {
      if (is_default) {
        await client.query(
          `UPDATE vehicles SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE`,
          [id]
        );
      }
      return createVehicle(client, id, name, is_default);
    });
    return res.status(201).json(created);
  }));

  // ── Database cleanup ───────────────────────────────────────

  // GET /api/admin/cleanup  →  report: duplicate trips, trips without vehicle
  router.get("/admin/cleanup", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    return res.json(await report(pool));
  }));

  // POST /api/admin/cleanup/duplicates  →  delete surplus duplicates
  // Body: { ids? }  without ids: all currently detected
  router.post("/admin/cleanup/duplicates", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { ids } = parse(duplicatesBody, req.body);
    const outcome = await withTransaction(pool, client => removeDuplicates(client, ids ?? null));
    console.log(`🧹 Admin ${req.userId}: ${outcome.removed} doppelte Fahrten gelöscht`);
    return res.json(outcome);
  }));

  // POST /api/admin/cleanup/unassigned  →  assign or delete trips without vehicle
  // Body: { user_id, action: "assign" | "delete", vehicle_id? }
  router.post("/admin/cleanup/unassigned", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const backupData = parse(unassignedBody, req.body);
    if (backupData.action === "assign") {
      const vehicle = await pool.query(`SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2`, [backupData.vehicle_id, backupData.user_id]);
      if (vehicle.rows.length === 0) {
        throw new HttpError(400, "errors.vehicleNotOwnedByUser");
      }
    }
    const outcome = await withTransaction(pool, client => handleUnassigned(client, backupData));
    console.log(`🧹 Admin ${req.userId}: ${outcome.count} Fahrten ohne Fahrzeug von User ${backupData.user_id} → ${backupData.action}`);
    return res.json(outcome);
  }));

  return router;
}
