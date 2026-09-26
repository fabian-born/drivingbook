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
import { TAX_COUNTRIES, adminUserUpdateBody, createUserBody, duplicatesBody, idParam, unassignedBody, vehicleBody } from "../schemas.js";

export function adminRoutes({ pool, requireAuth, requireAdmin }) {
  const router = express.Router();

  // GET /api/users  →  all users
  router.get("/users", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, username, role, country, created_at FROM users ORDER BY id ASC`
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

  // GET /api/admin/countries  →  countries the tax comparison supports
  router.get("/admin/countries", requireAuth, requireAdmin, (req, res) => res.json({ countries: TAX_COUNTRIES }));

  // PATCH /api/admin/users/:id  →  change role and/or country of a user
  // Body: { role?: "user" | "admin", country?: "DE" }
  // An admin cannot demote themselves, and the last admin always stays admin.
  router.patch("/admin/users/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { role, country } = parse(adminUserUpdateBody, req.body);
    if (role === "user" && id === req.userId) throw new HttpError(400, "errors.cannotDemoteSelf");

    const user = await withTransaction(pool, async client => {
      // Serializes concurrent role changes (last-admin check)
      await client.query(`SELECT id FROM users WHERE role = 'admin' FOR UPDATE`);
      const current = (await client.query(`SELECT role FROM users WHERE id = $1`, [id])).rows[0];
      if (!current) throw new HttpError(404, "errors.userNotFound");
      if (role === "user" && current.role === "admin") {
        const admins = (await client.query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`)).rows[0].n;
        if (admins <= 1) throw new HttpError(409, "errors.lastAdmin");
      }
      return (await client.query(
        `UPDATE users SET role = COALESCE($2, role), country = COALESCE($3, country)
         WHERE id = $1 RETURNING id, username, role, country, created_at`,
        [id, role ?? null, country ?? null]
      )).rows[0];
    });
    console.log(`👤 User ${id} geändert von Admin ${req.userId}: ${JSON.stringify({ role, country })}`);
    return res.json({ message: req.t("messages.userUpdated"), user });
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
