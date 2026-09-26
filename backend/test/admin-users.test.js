import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

describe("Admin: role and country of users", () => {
  let t, admin, user, userId, adminId;
  const patch = (id, body, auth = admin) => t.http().patch(`/api/admin/users/${id}`).set(auth).send(body);
  const idOf  = async name => (await t.pool.query(`SELECT id FROM users WHERE username = $1`, [name])).rows[0].id;

  before(async () => {
    t = await setup();
    admin = await t.login();
    user  = await t.registerUser("kollege");
    userId  = await idOf("kollege");
    adminId = await idOf("admin");
  });
  after(() => t.close());

  it("lists role and country, offers the supported countries", async () => {
    const list = (await t.http().get("/api/users").set(admin)).body;
    assert.deepEqual(list.find(u => u.username === "kollege").country, "DE");
    assert.deepEqual((await t.http().get("/api/admin/countries").set(admin)).body, { countries: ["DE"] });
  });

  it("makes a user admin – effective immediately, even with an old login token", async () => {
    assert.equal((await t.http().get("/api/users").set(user)).status, 403);
    const res = await patch(userId, { role: "admin" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "admin");
    assert.equal((await t.http().get("/api/users").set(user)).status, 200);   // same token as before
  });

  it("revokes admin rights immediately and protects self and the last admin", async () => {
    assert.equal((await patch(adminId, { role: "user" })).status, 400);        // not oneself
    assert.equal((await patch(userId, { role: "user" })).status, 200);
    assert.equal((await t.http().get("/api/users").set(user)).status, 403);    // old token no longer admin

    // Admins can demote each other, but never themselves – so one admin always remains
    await patch(userId, { role: "admin" });
    await patch(userId, { role: "user" }, user).expect(400);                   // self
    const res = await patch(adminId, { role: "user" }, user);                  // the other admin
    assert.equal(res.status, 200);
    assert.equal((await patch(adminId, { role: "admin" }, user)).status, 200); // and back
  });

  it("validates input and is admin-only", async () => {
    assert.equal((await patch(userId, {})).status, 400);
    assert.equal((await patch(userId, { role: "boss" })).status, 400);
    assert.equal((await patch(userId, { country: "AT" })).status, 400);        // not supported yet
    assert.equal((await patch(99999, { country: "DE" })).status, 404);
    assert.equal((await patch(userId, { country: "DE" })).status, 200);
    const other = await t.registerUser("neugierig2");
    assert.equal((await patch(userId, { role: "admin" }, other)).status, 403);
  });
});
