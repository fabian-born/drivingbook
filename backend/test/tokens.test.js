import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

describe("API tokens", () => {
  let t, user;
  before(async () => {
    t = await setup();
    user = await t.registerUser("tokenuser");
  });
  after(() => t.close());

  it("authenticates via Bearer and X-API-Token", async () => {
    const bearer = await t.http().get("/api/vehicles").set("Authorization", `Bearer ${user.apiToken}`);
    const header = await t.http().get("/api/vehicles").set("X-API-Token", user.apiToken);
    assert.equal(bearer.status, 200);
    assert.equal(header.status, 200);
  });

  it("returns new tokens in plain text exactly once and lists them without value", async () => {
    const created = await t.http().post("/api/tokens").set(user).send({ label: "Skript" });
    assert.equal(created.status, 201);
    assert.match(created.body.token, /^[0-9a-f]{64}$/);

    const list = await t.http().get("/api/tokens").set(user);
    assert.ok(list.body.every(tok => tok.token === undefined && tok.token_hash === undefined));
  });

  it("unsets the old default token when a new one is set", async () => {
    await t.http().post("/api/tokens").set(user).send({ label: "Neu", is_default: true });
    const list = await t.http().get("/api/tokens").set(user);
    assert.equal(list.body.filter(tok => tok.is_default).length, 1);
    assert.equal(list.body.find(tok => tok.is_default).label, "Neu");
  });

  it("invalidates deleted tokens immediately", async () => {
    const created = await t.http().post("/api/tokens").set(user).send({ label: "Wegwerf" });
    await t.http().delete(`/api/tokens/${created.body.id}`).set(user).expect(200);
    const res = await t.http().get("/api/vehicles").set("X-API-Token", created.body.token);
    assert.equal(res.status, 401);
  });

  it("no longer has a reveal endpoint", async () => {
    const res = await t.http().get("/api/tokens/1/reveal").set(user);
    assert.equal(res.status, 404);
  });

  it("validates IDs", async () => {
    const res = await t.http().delete("/api/tokens/abc").set(user);
    assert.equal(res.status, 400);
  });
});

describe("Migration of old plain-text tokens", () => {
  let t;
  before(async () => {
    // schema as created by the old init.sql, with plain-text tokens
    t = await setup({
      beforeMigrations: async pool => {
        await pool.query(`
          CREATE TABLE users (
            id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
          CREATE TABLE api_tokens (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(255) UNIQUE NOT NULL, label VARCHAR(100) NOT NULL DEFAULT 'Default',
            is_default BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
          INSERT INTO users (username, password, role) VALUES ('alt', 'x', 'user');
          INSERT INTO api_tokens (user_id, token, label) VALUES
            (1, 'fahrtenbuch-default-token-CHANGE-ME-1', 'Seed'),
            (1, 'bestehender-token-123', 'Bestand');
        `);
      },
    });
  });
  after(() => t.close());

  it("hashes existing tokens so they keep working", async () => {
    const res = await t.http().get("/api/vehicles").set("X-API-Token", "bestehender-token-123");
    assert.equal(res.status, 200);
  });

  it("revokes the predictable seed token", async () => {
    const res = await t.http().get("/api/vehicles").set("X-API-Token", "fahrtenbuch-default-token-CHANGE-ME-1");
    assert.equal(res.status, 401);
  });

  it("removes the plain-text column", async () => {
    const cols = await t.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'api_tokens'`
    );
    assert.ok(!cols.rows.some(c => c.column_name === "token"));
  });
});
