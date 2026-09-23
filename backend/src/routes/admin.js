// ============================================================
// Benutzerverwaltung (nur Admin)
// ============================================================

import express from "express";
import bcrypt  from "bcrypt";
import { asyncHandler, HttpError, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { createApiToken } from "../lib/tokens.js";
import { createUserBody, idParam, vehicleBody } from "../schemas.js";

export function adminRoutes({ pool, requireAuth, requireAdmin }) {
  const router = express.Router();

  // GET /api/users  →  Alle User
  router.get("/users", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, username, role, created_at FROM users ORDER BY id ASC`
    );
    return res.json(result.rows);
  }));

  // POST /api/users  →  Neuen User inkl. Default-Token anlegen
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
      if (err.code === "23505") throw new HttpError(409, "Benutzername bereits vergeben");
      throw err;
    }
  }));

  // POST /api/admin/users/:id/vehicle  →  Fahrzeug für anderen User anlegen
  router.post("/admin/users/:id/vehicle", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { name } = parse(vehicleBody, req.body);

    const userCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [id]);
    if (userCheck.rows.length === 0) {
      throw new HttpError(404, "User nicht gefunden");
    }

    const result = await pool.query(
      `INSERT INTO vehicles (user_id, name) VALUES ($1, $2) RETURNING id, name`,
      [id, name]
    );
    return res.status(201).json(result.rows[0]);
  }));

  return router;
}
