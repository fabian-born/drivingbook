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

// Stand vor 011: Migrationen 001–010 einspielen und als angewendet vermerken
async function schemaVor011(pool) {
  await pool.query(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const datei of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql") && f < "011").sort()) {
    await pool.query(fs.readFileSync(path.join(MIGRATIONS, datei), "utf8"));
    await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [datei]);
  }
}

describe("Migration 011: bestehende deutsche Daten auf Englisch umstellen", () => {
  let pool, http, token, vehicleId, fahrtId;

  before(async () => {
    const config = testConfig();
    pool = createPool(config.db);

    // Altbestand mit deutschen Namen, Werten und Protokoll anlegen
    await resetDatabase(pool, {
      beforeMigrations: async p => {
        await schemaVor011(p);
        const userId = (await p.query(`INSERT INTO users (username, password) VALUES ('alt', $1) RETURNING id`,
          [await bcrypt.hash("passwort123", 4)])).rows[0].id;
        vehicleId = (await p.query(
          `INSERT INTO vehicles (user_id, name, code, is_default, drive_type) VALUES ($1, 'Golf', 'ALT123', TRUE, 'elektro_teuer') RETURNING id`,
          [userId])).rows[0].id;
        fahrtId = (await p.query(
          `INSERT INTO fahrten (user_id, vehicle_id, kmstand, ziel, fahrtart, timestamp)
           VALUES ($1, $2, 1000, 'Kunde', 'geschäftlich', '2026-03-01T08:00:00Z') RETURNING id`,
          [userId, vehicleId])).rows[0].id;
        await p.query(`INSERT INTO fahrten (user_id, vehicle_id, kmstand, ziel, fahrtart, timestamp)
                       VALUES ($1, $2, 1050, 'Büro', 'arbeitsweg', '2026-03-02T08:00:00Z')`, [userId, vehicleId]);
        const alt = { kmstand: 1000, ziel: "Kunde", fahrtart: "privat", timestamp: "2026-03-01T08:00:00.000Z", vehicle_id: vehicleId };
        const neu = { ...alt, fahrtart: "geschäftlich" };
        await p.query(`INSERT INTO fahrten_audit (fahrt_id, user_id, action, old_data, new_data, source)
                       VALUES ($1, $2, 'create', NULL, $3, 'web'), ($1, $2, 'update', $3, $4, 'web')`,
          [fahrtId, userId, alt, neu]);
      },
    });

    const app = createApp({ pool, config, geocode: async z => z });
    http = () => request(app);
    token = (await http().post("/api/login").send({ username: "alt", password: "passwort123" })).body.token;
  });
  after(() => pool.end());

  it("benennt Tabellen, Spalten und Werte um", async () => {
    const tabellen = (await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).rows.map(r => r.table_name);
    assert.ok(tabellen.includes("trips") && tabellen.includes("trip_audit"));
    assert.ok(!tabellen.includes("fahrten") && !tabellen.includes("fahrten_audit"));

    const fahrten = (await pool.query(`SELECT odometer_km, destination, trip_type FROM trips ORDER BY id`)).rows;
    assert.deepEqual(fahrten, [
      { odometer_km: 1000, destination: "Kunde", trip_type: "business" },
      { odometer_km: 1050, destination: "Büro", trip_type: "commute" },
    ]);
    const vehicle = (await pool.query(`SELECT drive_type FROM vehicles WHERE id = $1`, [vehicleId])).rows[0];
    assert.equal(vehicle.drive_type, "electric_high_price");

    // alte Werte werden abgelehnt
    await assert.rejects(pool.query(`UPDATE trips SET trip_type = 'privat'`), err => err.code === "23514");
  });

  it("schreibt das Änderungsprotokoll um", async () => {
    const eintraege = (await pool.query(`SELECT trip_id, old_data, new_data FROM trip_audit ORDER BY id`)).rows;
    assert.equal(eintraege[0].trip_id, fahrtId);
    assert.equal(eintraege[0].old_data, null);
    assert.deepEqual(eintraege[1].old_data, {
      odometer_km: 1000, destination: "Kunde", trip_type: "private", timestamp: "2026-03-01T08:00:00.000Z", vehicle_id: vehicleId,
    });
    assert.equal(eintraege[1].new_data.trip_type, "business");
  });

  it("liefert über die API unverändert deutsche Namen und Werte", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const jahr = await http().get("/api/fahrten?year=2026&vehicle=ALT123").set(auth);
    assert.deepEqual(jahr.body.fahrten.map(f => [f.kmstand, f.ziel, f.fahrtart]), [[1000, "Kunde", "geschäftlich"], [1050, "Büro", "arbeitsweg"]]);
    assert.deepEqual(jahr.body.summe, { fahrten: 2, gesamt: 50, privat: 0, geschaeftlich: 0, arbeitsweg: 50 });

    const verlauf = await http().get(`/api/fahrt/${fahrtId}/history`).set(auth);
    assert.deepEqual(verlauf.body[1].old_data, {
      kmstand: 1000, ziel: "Kunde", fahrtart: "privat", timestamp: "2026-03-01T08:00:00.000Z", vehicle_id: vehicleId,
    });

    const fahrzeuge = await http().get("/api/vehicles").set(auth);
    assert.equal(fahrzeuge.body[0].drive_type, "elektro_teuer");

    // neue Fahrt mit deutschen Werten anlegen
    const neu = await http().post("/api/fahrt").set(auth)
      .send({ kmstand: 1100, ziel: "Heim", fahrtart: "privat", timestamp: "2026-03-03T08:00:00Z" });
    assert.equal(neu.status, 200);
    const gespeichert = (await pool.query(`SELECT trip_type FROM trips WHERE id = $1`, [neu.body.id])).rows[0];
    assert.equal(gespeichert.trip_type, "private");
  });

  it("läuft nur einmal", async () => {
    await runMigrations(pool);   // nichts mehr zu tun
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM schema_migrations WHERE name LIKE '011%'`)).rows[0].n;
    assert.equal(n, 1);
  });
});
