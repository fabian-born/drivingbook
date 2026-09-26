import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import bcrypt from "bcrypt";
import { createPool, runMigrations } from "../src/db.js";
import { createApp } from "../src/app.js";
import { resetDatabase, testConfig } from "./helpers.js";

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// State before 011: apply migrations 001–010 and mark them as applied
async function schemaBefore011(pool) {
  await pool.query(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const backupFile of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql") && f < "011").sort()) {
    await pool.query(fs.readFileSync(path.join(MIGRATIONS, backupFile), "utf8"));
    await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [backupFile]);
  }
}

describe("Migration 011: convert existing German data to English", () => {
  let pool, http, token, vehicleId, tripId;

  before(async () => {
    const config = testConfig();
    pool = createPool(config.db);

    // create legacy data with German names, values and audit log
    await resetDatabase(pool, {
      beforeMigrations: async p => {
        await schemaBefore011(p);
        const userId = (await p.query(`INSERT INTO users (username, password) VALUES ('alt', $1) RETURNING id`,
          [await bcrypt.hash("passwort123", 4)])).rows[0].id;
        vehicleId = (await p.query(
          `INSERT INTO vehicles (user_id, name, code, is_default, drive_type) VALUES ($1, 'Golf', 'ALT123', TRUE, 'elektro_teuer') RETURNING id`,
          [userId])).rows[0].id;
        tripId = (await p.query(
          `INSERT INTO fahrten (user_id, vehicle_id, kmstand, ziel, fahrtart, timestamp)
           VALUES ($1, $2, 1000, 'Kunde', 'geschäftlich', '2026-03-01T08:00:00Z') RETURNING id`,
          [userId, vehicleId])).rows[0].id;
        await p.query(`INSERT INTO fahrten (user_id, vehicle_id, kmstand, ziel, fahrtart, timestamp)
                       VALUES ($1, $2, 1050, 'Büro', 'arbeitsweg', '2026-03-02T08:00:00Z')`, [userId, vehicleId]);
        const old = { kmstand: 1000, ziel: "Kunde", fahrtart: "privat", timestamp: "2026-03-01T08:00:00.000Z", vehicle_id: vehicleId };
        const newValue = { ...old, fahrtart: "geschäftlich" };
        await p.query(`INSERT INTO fahrten_audit (fahrt_id, user_id, action, old_data, new_data, source)
                       VALUES ($1, $2, 'create', NULL, $3, 'web'), ($1, $2, 'update', $3, $4, 'web')`,
          [tripId, userId, old, newValue]);
      },
    });

    const app = createApp({ pool, config, geocode: async z => z });
    http = () => request(app);
    token = (await http().post("/api/login").send({ username: "alt", password: "passwort123" })).body.token;
  });
  after(() => pool.end());

  it("renames tables, columns and values", async () => {
    const tables = (await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).rows.map(r => r.table_name);
    assert.ok(tables.includes("trips") && tables.includes("trip_audit"));
    assert.ok(!tables.includes("fahrten") && !tables.includes("fahrten_audit"));

    const trips = (await pool.query(`SELECT odometer_km, destination, trip_type FROM trips ORDER BY id`)).rows;
    assert.deepEqual(trips, [
      { odometer_km: 1000, destination: "Kunde", trip_type: "business" },
      { odometer_km: 1050, destination: "Büro", trip_type: "commute" },
    ]);
    const vehicle = (await pool.query(`SELECT drive_type FROM vehicles WHERE id = $1`, [vehicleId])).rows[0];
    assert.equal(vehicle.drive_type, "electric_high_price");

    // old values are rejected
    await assert.rejects(pool.query(`UPDATE trips SET trip_type = 'privat'`), err => err.code === "23514");
  });

  it("rewrites the audit log", async () => {
    const entryList = (await pool.query(`SELECT trip_id, old_data, new_data FROM trip_audit ORDER BY id`)).rows;
    assert.equal(entryList[0].trip_id, tripId);
    assert.equal(entryList[0].old_data, null);
    assert.deepEqual(entryList[1].old_data, {
      odometer_km: 1000, destination: "Kunde", trip_type: "private", timestamp: "2026-03-01T08:00:00.000Z", vehicle_id: vehicleId,
    });
    assert.equal(entryList[1].new_data.trip_type, "business");
  });

  it("returns the converted data via the (English) API", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const yearData = await http().get("/api/trips?year=2026&vehicle=ALT123").set(auth);
    assert.deepEqual(yearData.body.trips.map(f => [f.odometer_km, f.destination, f.trip_type]), [[1000, "Kunde", "business"], [1050, "Büro", "commute"]]);
    assert.deepEqual(yearData.body.totals, { trips: 2, total: 50, business: 0, private: 0, commute: 50 });

    const history = await http().get(`/api/trips/${tripId}/history`).set(auth);
    assert.deepEqual(history.body[1].old_data, {
      odometer_km: 1000, destination: "Kunde", trip_type: "private", timestamp: "2026-03-01T08:00:00.000Z", vehicle_id: vehicleId,
    });

    const vehicles = await http().get("/api/vehicles").set(auth);
    assert.equal(vehicles.body[0].drive_type, "electric_high_price");

    const newValue = await http().post("/api/trips").set(auth)
      .send({ odometer_km: 1100, destination: "Heim", trip_type: "private", timestamp: "2026-03-03T08:00:00Z" });
    assert.equal(newValue.status, 200);
  });

  it("runs only once", async () => {
    await runMigrations(pool);   // nothing left to do
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM schema_migrations WHERE name LIKE '011%'`)).rows[0].n;
    assert.equal(n, 1);
  });
});
