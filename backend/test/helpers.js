// ============================================================
// Test-Helfer: frische Datenbank + App pro Testdatei
// Benötigt eine erreichbare PostgreSQL-Instanz (DB_HOST, DB_PORT,
// DB_NAME, DB_USER, DB_PASSWORD). ACHTUNG: Das Schema "public" der
// Test-Datenbank wird bei jedem Lauf komplett geleert – der Datenbankname
// muss deshalb "test" enthalten, sonst bricht der Lauf ab.
// ============================================================

import request from "supertest";
import { loadConfig } from "../src/config.js";
import { createPool, runMigrations } from "../src/db.js";
import { ensureAdmin } from "../src/bootstrap.js";
import { createApp } from "../src/app.js";

export const ADMIN_PASSWORD = "admin-test-pw";

export function testConfig(overrides = {}) {
  return {
    ...loadConfig({
      ...process.env,
      JWT_SECRET:     "test-secret-".padEnd(48, "x"),
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD,
      GEOCODING:      "false",
    }),
    ...overrides,
  };
}

// Leert die Datenbank. `beforeMigrations(pool)` kann z. B. ein altes Schema anlegen.
export async function resetDatabase(pool, { beforeMigrations } = {}) {
  // Schutz: nie eine echte Datenbank leeren
  const { current_database: name } = (await pool.query("SELECT current_database()")).rows[0];
  if (!/test/i.test(name)) {
    throw new Error(`Datenbank "${name}" sieht nicht nach einer Testdatenbank aus (Name muss "test" enthalten) – Abbruch`);
  }
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  if (beforeMigrations) await beforeMigrations(pool);
  await runMigrations(pool);
}

export async function setup({ config: configOverrides, beforeMigrations } = {}) {
  const config = testConfig(configOverrides);
  const pool   = createPool(config.db);

  await resetDatabase(pool, { beforeMigrations });
  await ensureAdmin(pool, config.admin);

  const app  = createApp({ pool, config, geocode: async ziel => ziel });
  const http = () => request(app);

  // Loggt ein und liefert den Authorization-Header
  async function login(username = "admin", password = ADMIN_PASSWORD) {
    const res = await http().post("/api/login").send({ username, password });
    if (res.status !== 200) throw new Error(`Login fehlgeschlagen: ${res.status} ${JSON.stringify(res.body)}`);
    return { Authorization: `Bearer ${res.body.token}` };
  }

  // Registriert einen neuen User und liefert den Authorization-Header
  async function registerUser(username, password = "password123") {
    const res = await http().post("/api/register").send({ username, password });
    if (res.status !== 201) throw new Error(`Registrierung fehlgeschlagen: ${res.status}`);
    return { Authorization: `Bearer ${res.body.token}`, apiToken: res.body.default_token, vehicle: res.body.vehicle };
  }

  return { app, pool, config, http, login, registerUser, close: () => pool.end() };
}
