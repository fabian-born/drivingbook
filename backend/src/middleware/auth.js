// ============================================================
// Auth middleware
// Accepts:
//   1. Authorization: Bearer <JWT>        (login flow)
//   2. Authorization: Bearer <API-Token>  (direct API access)
//   3. X-API-Token: <API-Token>           (alternative for API clients)
// Sets req.userId, req.role and req.authSource ('web' | 'api_token').
// ============================================================

import jwt from "jsonwebtoken";
import { asyncHandler, HttpError } from "../http.js";
import { hashToken } from "../lib/tokens.js";

export function createAuth({ pool, config }) {
  const requireAuth = asyncHandler(async (req, res, next) => {
    let rawToken = null;

    const authHeader = req.headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      rawToken = authHeader.slice(7).trim();
    } else if (req.headers["x-api-token"]) {
      rawToken = String(req.headers["x-api-token"]).trim();
    }

    if (!rawToken) {
      throw new HttpError(401, "errors.noToken");
    }

    // ── Attempt 1: JWT ─────────────────────────────────────
    try {
      const payload = jwt.verify(rawToken, config.jwtSecret);
      req.userId     = payload.userId;
      req.role       = payload.role;
      req.authSource = "web";
      return next();
    } catch {
      // no valid JWT → continue with API token check
    }

    // ── Attempt 2: API token from DB ───────────────────────
    const result = await pool.query(
      `SELECT u.id, u.role
       FROM   api_tokens t
       JOIN   users u ON u.id = t.user_id
       WHERE  t.token_hash = $1`,
      [hashToken(rawToken)]
    );

    if (result.rows.length === 0) {
      throw new HttpError(401, "errors.invalidToken");
    }

    req.userId     = result.rows[0].id;
    req.role       = result.rows[0].role;
    req.authSource = "api_token";
    return next();
  });

  // Checks the current role in the database – a revoked admin role applies
  // immediately, not only when the login token expires
  const requireAdmin = asyncHandler(async (req, res, next) => {
    const result = await pool.query(`SELECT role FROM users WHERE id = $1`, [req.userId]);
    if (result.rows[0]?.role !== "admin") {
      throw new HttpError(403, "errors.adminOnly");
    }
    req.role = "admin";
    return next();
  });

  return { requireAuth, requireAdmin };
}
