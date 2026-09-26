import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { hashToken } from "../src/lib/tokens.js";
import { ADMIN_PASSWORD, setup } from "./helpers.js";

describe("Konfiguration", () => {
  it("verweigert fehlendes, kurzes oder Platzhalter-JWT_SECRET", () => {
    assert.throws(() => loadConfig({}), /JWT_SECRET/);
    assert.throws(() => loadConfig({ JWT_SECRET: "kurz" }), /JWT_SECRET/);
    assert.throws(() => loadConfig({ JWT_SECRET: "CHANGE_ME_IN_PRODUCTION".padEnd(40, "x") }), /JWT_SECRET/);
    assert.equal(loadConfig({ JWT_SECRET: "a".repeat(32) }).jwtSecret, "a".repeat(32));
  });
});

describe("Login & Registrierung", () => {
  let t;
  before(async () => { t = await setup(); });
  after(() => t.close());

  it("legt beim ersten Start den Admin an und erlaubt den Login", async () => {
    const res = await t.http().post("/api/login").send({ username: "admin", password: ADMIN_PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "admin");
  });

  it("lehnt falsche Zugangsdaten und unbekannte User gleich ab", async () => {
    const wrong   = await t.http().post("/api/login").send({ username: "admin", password: "falsch" });
    const unknown = await t.http().post("/api/login").send({ username: "gibtsnicht", password: "x" });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  it("sperrt nach 10 Fehlversuchen je IP + Benutzername", async () => {
    for (let i = 0; i < 10; i++) {
      await t.http().post("/api/login").send({ username: "sperre", password: "x" });
    }
    const res = await t.http().post("/api/login").send({ username: "sperre", password: "x" });
    assert.equal(res.status, 429);
  });

  it("registriert mit Fahrzeugname, Default-Token und direktem Login", async () => {
    const res = await t.http().post("/api/register")
      .send({ username: "fabian", password: "password123", vehicleName: "Golf" });
    assert.equal(res.status, 201);
    assert.equal(res.body.vehicle.name, "Golf");
    assert.match(res.body.default_token, /^[0-9a-f]{64}$/);

    const profile = await t.http().get("/api/profile").set("Authorization", `Bearer ${res.body.token}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.username, "fabian");
  });

  it("akzeptiert vehicle_name von älteren API-Clients", async () => {
    const res = await t.http().post("/api/register")
      .send({ username: "alt", password: "password123", vehicle_name: "Polo" });
    assert.equal(res.body.vehicle.name, "Polo");
  });

  it("speichert Benutzernamen klein und meldet sich unabhängig von Groß-/Kleinschreibung an", async () => {
    const admin = await t.login();
    const created = await t.http().post("/api/users").set(admin).send({ username: "  GrossKlein ", password: "password123" });
    assert.equal(created.status, 201);
    assert.equal(created.body.username, "grossklein");

    const res = await t.http().post("/api/login").send({ username: "GROSSKLEIN", password: "password123" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, "grossklein");

    const dup = await t.http().post("/api/users").set(admin).send({ username: "grossKLEIN", password: "password123" });
    assert.equal(dup.status, 409);
  });

  it("meldet doppelte Benutzernamen und zu kurze Passwörter", async () => {
    const dup = await t.http().post("/api/register").send({ username: "fabian", password: "password123" });
    assert.equal(dup.status, 409);
    const short = await t.http().post("/api/register").send({ username: "neu", password: "kurz" });
    assert.equal(short.status, 400);
  });

  it("speichert API-Tokens nur als Hash", async () => {
    const res = await t.http().post("/api/register").send({ username: "hash", password: "password123" });
    const rows = (await t.pool.query("SELECT token_hash FROM api_tokens")).rows.map(r => r.token_hash);
    assert.ok(rows.includes(hashToken(res.body.default_token)));
    assert.ok(!rows.includes(res.body.default_token));
  });

  it("liefert JSON-Fehler für unbekannte Endpunkte und kaputtes JSON", async () => {
    const unknown = await t.http().get("/api/gibtsnicht");
    assert.equal(unknown.status, 404);
    assert.ok(unknown.body.error);

    const broken = await t.http().post("/api/login").set("Content-Type", "application/json").send("{kaputt");
    assert.equal(broken.status, 400);
  });

  it("meldet Gesundheit über /api/health", async () => {
    const res = await t.http().get("/api/health");
    assert.equal(res.body.status, "ok");
    assert.match(res.body.version, /^(\d{4}\.\d{2}\.\d{2}\.\d+|dev)$/);
  });

  it("sendet ohne CORS_ORIGIN keine CORS-Header", async () => {
    const res = await t.http().get("/api/health").set("Origin", "https://evil.example");
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
});

describe("Registrierung deaktiviert", () => {
  let t;
  before(async () => { t = await setup({ config: { allowRegistration: false } }); });
  after(() => t.close());

  it("antwortet mit 403", async () => {
    const res = await t.http().post("/api/register").send({ username: "x", password: "password123" });
    assert.equal(res.status, 403);
  });
});

describe("Eindeutige Benutzernamen in der Datenbank", () => {
  let t;
  before(async () => { t = await setup(); });
  after(() => t.close());

  it("verhindert Namen, die sich nur in Groß-/Kleinschreibung unterscheiden", async () => {
    await assert.rejects(
      t.pool.query(`INSERT INTO users (username, password) VALUES ('ADMIN', 'x')`),
      err => err.code === "23505"
    );
  });
});

describe("Altkonten mit Groß-/Kleinschreibung", () => {
  let t;
  before(async () => {
    // "Max" und "max" existieren schon vor Migration 005 → "Max" bleibt, kein Unique-Index
    t = await setup({
      beforeMigrations: async pool => {
        await pool.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const bcrypt = (await import("bcrypt")).default;
        await pool.query(`INSERT INTO users (username, password) VALUES ('Max', $1), ('max', $2)`,
          [await bcrypt.hash("passwort-gross", 4), await bcrypt.hash("passwort-klein", 4)]);
      },
    });
  });
  after(() => t.close());

  it("meldet jedes Konto mit seinem eigenen Passwort an", async () => {
    const gross = await t.http().post("/api/login").send({ username: "Max", password: "passwort-gross" });
    const klein = await t.http().post("/api/login").send({ username: "MAX", password: "passwort-klein" });
    assert.equal(gross.status, 200);
    assert.equal(gross.body.user.username, "Max");
    assert.equal(klein.status, 200);
    assert.equal(klein.body.user.username, "max");
    assert.equal((await t.http().post("/api/login").send({ username: "max", password: "falsch" })).status, 401);
  });
});
