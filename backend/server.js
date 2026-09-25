// ============================================================
// Fahrtenbuch – Backend
// Node.js + Express + PostgreSQL
// Auth: JWT (Login) + API-Token (direkte API-Nutzung)
// ============================================================

import { loadConfig } from "./src/config.js";
import { createPool, runMigrations, waitForDatabase } from "./src/db.js";
import { ensureAdmin } from "./src/bootstrap.js";
import { createApp, VERSION } from "./src/app.js";

async function start() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const pool = createPool(config.db);

  try {
    await waitForDatabase(pool);
    console.log("✅ Datenbankverbindung erfolgreich");
    await runMigrations(pool);
    await ensureAdmin(pool, config.admin);
  } catch (err) {
    console.error("❌ Initialisierung fehlgeschlagen:", err.message);
    process.exit(1);
  }

  const server = createApp({ pool, config }).listen(config.port, () => {
    console.log(`🚀 Backend ${VERSION} läuft auf http://localhost:${config.port}`);
    console.log(`   JWT_EXPIRES : ${config.jwtExpires}`);
    console.log(`   DB_HOST     : ${config.db.host}`);
  });

  // Sauber beenden, wenn Docker den Container stoppt
  const shutdown = signal => {
    console.log(`${signal} empfangen – fahre herunter …`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start();
