// ============================================================
// Express app (without starting the server, so tests can use it)
// ============================================================

import fs      from "fs";
import express from "express";
import cors    from "cors";
import { asyncHandler, errorHandler, HttpError } from "./http.js";
import { createAuth } from "./middleware/auth.js";
import { createGeocoder } from "./lib/geocode.js";
import { authRoutes } from "./routes/auth.js";
import { accountRoutes } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";
import { tripRoutes } from "./routes/fahrten.js";
import { exportRoutes } from "./routes/export.js";
import { vehicleRoutes } from "./routes/vehicles.js";
import { backupRoutes } from "./routes/backup.js";

// Version from release.ver (bumped automatically on commit)
export const VERSION = (() => {
  try {
    return fs.readFileSync(new URL("../release.ver", import.meta.url), "utf8").trim();
  } catch {
    return "dev";
  }
})();

export function createApp({ pool, config, geocode = createGeocoder(config.geocoding) }) {
  const app = express();

  if (config.trustProxy) {
    app.set("trust proxy", config.trustProxy);
  }
  app.disable("x-powered-by");
  // Backups can be large (own limits in the routes); all other requests stay small
  const LARGE_UPLOADS = new Set(["/api/vehicles/import", "/api/backup/restore"]);
  const smallJson = express.json({ limit: "100kb" });
  app.use((req, res, next) => (LARGE_UPLOADS.has(req.path) ? next() : smallJson(req, res, next)));

  // Without CORS_ORIGIN no CORS headers → browsers only allow same-origin calls
  if (config.corsOrigins.length > 0) {
    app.use(cors({ origin: config.corsOrigins }));
  }

  const { requireAuth, requireAdmin } = createAuth({ pool, config });
  const deps = { pool, config, requireAuth, requireAdmin, geocode };

  // GET /api/health  →  for container health checks
  app.get("/api/health", asyncHandler(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", version: VERSION });
  }));

  app.use("/api", authRoutes(deps));
  app.use("/api", accountRoutes(deps));
  app.use("/api", adminRoutes(deps));
  app.use("/api", tripRoutes(deps));
  app.use("/api", exportRoutes(deps));
  app.use("/api", vehicleRoutes(deps));
  app.use("/api", backupRoutes(deps));

  app.use("/api", (req, res, next) => next(new HttpError(404, "Endpunkt nicht gefunden")));
  app.use(errorHandler);

  return app;
}
