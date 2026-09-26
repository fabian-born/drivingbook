import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { hashToken } from "../src/lib/tokens.js";
import { ADMIN_PASSWORD, setup } from "./helpers.js";

describe("Configuration", () => {
  it("rejects a missing, short or placeholder JWT_SECRET", () => {
    assert.throws(() => loadConfig({}), /JWT_SECRET/);
    assert.throws(() => loadConfig({ JWT_SECRET: "kurz" }), /JWT_SECRET/);
    assert.throws(() => loadConfig({ JWT_SECRET: "CHANGE_ME_IN_PRODUCTION".padEnd(40, "x") }), /JWT_SECRET/);
    assert.equal(loadConfig({ JWT_SECRET: "a".repeat(32) }).jwtSecret, "a".repeat(32));
  });
});

describe("Login & registration", () => {
  let t;
  before(async () => { t = await setup(); });
  after(() => t.close());

  it("creates the admin on first start and allows login", async () => {
    const res = await t.http().post("/api/login").send({ username: "admin", password: ADMIN_PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "admin");
  });

  it("rejects wrong credentials and unknown users identically", async () => {
    const wrong   = await t.http().post("/api/login").send({ username: "admin", password: "falsch" });
    const unknown = await t.http().post("/api/login").send({ username: "gibtsnicht", password: "x" });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  it("locks out after 10 failed attempts per IP + username", async () => {
    for (let i = 0; i < 10; i++) {
      await t.http().post("/api/login").send({ username: "sperre", password: "x" });
    }
    const res = await t.http().post("/api/login").send({ username: "sperre", password: "x" });
    assert.equal(res.status, 429);
  });

  it("registers with vehicle name, default token and immediate login", async () => {
    const res = await t.http().post("/api/register")
      .send({ username: "fabian", password: "password123", vehicleName: "Golf" });
    assert.equal(res.status, 201);
    assert.equal(res.body.vehicle.name, "Golf");
    assert.match(res.body.default_token, /^[0-9a-f]{64}$/);

    const profile = await t.http().get("/api/profile").set("Authorization", `Bearer ${res.body.token}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.username, "fabian");
    assert.equal(profile.body.user.country, "DE");   // default until a country can be chosen
  });

  it("accepts vehicle_name from older API clients", async () => {
    const res = await t.http().post("/api/register")
      .send({ username: "alt", password: "password123", vehicle_name: "Polo" });
    assert.equal(res.body.vehicle.name, "Polo");
  });

  it("stores usernames in lowercase and logs in case-insensitively", async () => {
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

  it("reports duplicate usernames and too-short passwords", async () => {
    const dup = await t.http().post("/api/register").send({ username: "fabian", password: "password123" });
    assert.equal(dup.status, 409);
    const short = await t.http().post("/api/register").send({ username: "neu", password: "kurz" });
    assert.equal(short.status, 400);
  });

  it("stores API tokens only as hashes", async () => {
    const res = await t.http().post("/api/register").send({ username: "hash", password: "password123" });
    const rows = (await t.pool.query("SELECT token_hash FROM api_tokens")).rows.map(r => r.token_hash);
    assert.ok(rows.includes(hashToken(res.body.default_token)));
    assert.ok(!rows.includes(res.body.default_token));
  });

  it("returns JSON errors for unknown endpoints and malformed JSON", async () => {
    const unknown = await t.http().get("/api/gibtsnicht");
    assert.equal(unknown.status, 404);
    assert.ok(unknown.body.error);

    const broken = await t.http().post("/api/login").set("Content-Type", "application/json").send("{kaputt");
    assert.equal(broken.status, 400);
  });

  it("reports health via /api/health", async () => {
    const res = await t.http().get("/api/health");
    assert.equal(res.body.status, "ok");
    assert.match(res.body.version, /^(\d{4}\.\d{2}\.\d{2}\.\d+|dev)$/);
  });

  it("sends no CORS headers without CORS_ORIGIN", async () => {
    const res = await t.http().get("/api/health").set("Origin", "https://evil.example");
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
});

describe("Registration disabled", () => {
  let t;
  before(async () => { t = await setup({ config: { allowRegistration: false } }); });
  after(() => t.close());

  it("responds with 403", async () => {
    const res = await t.http().post("/api/register").send({ username: "x", password: "password123" });
    assert.equal(res.status, 403);
  });
});

describe("Unique usernames in the database", () => {
  let t;
  before(async () => { t = await setup(); });
  after(() => t.close());

  it("prevents names that differ only in case", async () => {
    await assert.rejects(
      t.pool.query(`INSERT INTO users (username, password) VALUES ('ADMIN', 'x')`),
      err => err.code === "23505"
    );
  });
});

describe("Legacy accounts with mixed case", () => {
  let t;
  before(async () => {
    // "Max" and "max" already exist before migration 005 → "Max" stays, no unique index
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

  it("logs in each account with its own password", async () => {
    const big = await t.http().post("/api/login").send({ username: "Max", password: "passwort-gross" });
    const small = await t.http().post("/api/login").send({ username: "MAX", password: "passwort-klein" });
    assert.equal(big.status, 200);
    assert.equal(big.body.user.username, "Max");
    assert.equal(small.status, 200);
    assert.equal(small.body.user.username, "max");
    assert.equal((await t.http().post("/api/login").send({ username: "max", password: "falsch" })).status, 401);
  });
});
