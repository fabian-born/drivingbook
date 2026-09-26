// ============================================================
// Login & Registrierung (öffentlich)
// ============================================================

import express from "express";
import bcrypt  from "bcrypt";
import jwt     from "jsonwebtoken";
import { asyncHandler, HttpError, parse } from "../http.js";
import { withTransaction } from "../db.js";
import { createLimiter } from "../lib/rateLimit.js";
import { createApiToken } from "../lib/tokens.js";
import { createVehicle } from "../lib/vehicles.js";
import { loginBody, registerBody } from "../schemas.js";

export function authRoutes({ pool, config }) {
  const router = express.Router();

  // Fehlgeschlagene Logins: 10 pro 15 Minuten je IP + Benutzername
  const loginLimiter    = createLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  // Registrierungen: 5 pro Stunde je IP
  const registerLimiter = createLimiter({ max: 5,  windowMs: 60 * 60 * 1000 });

  const signJwt = user => jwt.sign(
    { userId: user.id, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpires }
  );

  // POST /api/login  →  JWT zurückgeben
  router.post("/login", asyncHandler(async (req, res) => {
    const { username, password } = parse(loginBody, req.body);

    const limitKey = `${req.ip}|${username}`;
    if (loginLimiter.blocked(limitKey)) {
      throw new HttpError(429, "Zu viele fehlgeschlagene Anmeldeversuche – bitte später erneut versuchen");
    }

    // Alte Konten, die sich nur in Groß-/Kleinschreibung unterscheiden ("Max"/"max",
    // siehe Migration 005), bleiben erreichbar: es gilt das Konto mit passendem Passwort
    const kandidaten = (await pool.query(
      `SELECT id, username, password, role FROM users WHERE LOWER(username) = $1 ORDER BY (username = $1) DESC, id`,
      [username]
    )).rows;
    let user = null;
    for (const k of kandidaten) {
      if (await bcrypt.compare(password, k.password)) { user = k; break; }
    }

    if (!user) {
      loginLimiter.hit(limitKey);
      throw new HttpError(401, "Ungültige Zugangsdaten");
    }

    loginLimiter.reset(limitKey);
    return res.json({ token: signJwt(user), user: { username: user.username, role: user.role } });
  }));

  // POST /api/register  →  Neuen User registrieren
  // Body: { username, password, vehicleName? }  (vehicle_name wird ebenfalls akzeptiert)
  router.post("/register", asyncHandler(async (req, res) => {
    if (!config.allowRegistration) {
      throw new HttpError(403, "Registrierung ist deaktiviert");
    }
    if (registerLimiter.blocked(req.ip)) {
      throw new HttpError(429, "Zu viele Registrierungen – bitte später erneut versuchen");
    }
    registerLimiter.hit(req.ip);

    const { username, password, vehicleName } = parse(registerBody, req.body);
    const hash = await bcrypt.hash(password, 12);

    let created;
    try {
      created = await withTransaction(pool, async client => {
        const user = (await client.query(
          `INSERT INTO users (username, password, role)
           VALUES ($1, $2, 'user') RETURNING id, username, role`,
          [username, hash]
        )).rows[0];

        const { token } = await createApiToken(client, user.id, "Default", true);
        const vehicle = await createVehicle(client, user.id, vehicleName, true);

        return { user, token, vehicle };
      });
    } catch (err) {
      if (err.code === "23505") throw new HttpError(409, "Benutzername bereits vergeben");
      throw err;
    }

    const { user, token, vehicle } = created;
    console.log(`✅ Neuer User registriert: ${user.username} (ID: ${user.id})`);

    // JWT direkt mitgeben → sofort eingeloggt nach Registrierung
    return res.status(201).json({
      token:         signJwt(user),
      user:          { username: user.username, role: user.role },
      default_token: token,
      vehicle,
    });
  }));

  return router;
}
