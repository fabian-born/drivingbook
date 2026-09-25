// ============================================================
// Express-App (ohne Serverstart, damit sie in Tests nutzbar ist)
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
import { fahrtenRoutes } from "./routes/fahrten.js";
import { exportRoutes } from "./routes/export.js";

// Version aus release.ver (wird beim Commit automatisch hochgezählt)
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
  app.use(express.json({ limit: "100kb" }));

  // Ohne CORS_ORIGIN keine CORS-Header → Browser erlauben nur Aufrufe von der gleichen Origin
  if (config.corsOrigins.length > 0) {
    app.use(cors({ origin: config.corsOrigins }));
  }

  const { requireAuth, requireAdmin } = createAuth({ pool, config });
  const deps = { pool, config, requireAuth, requireAdmin, geocode };

  // GET /api/health  →  für Container-Healthchecks
  app.get("/api/health", asyncHandler(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", version: VERSION });
  }));

  app.use("/api", authRoutes(deps));
  app.use("/api", accountRoutes(deps));
  app.use("/api", adminRoutes(deps));
  app.use("/api", fahrtenRoutes(deps));
  app.use("/api", exportRoutes(deps));

  app.use("/api", (req, res, next) => next(new HttpError(404, "Endpunkt nicht gefunden")));
  app.use(errorHandler);

  return app;
}
