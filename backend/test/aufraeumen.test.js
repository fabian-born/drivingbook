import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

describe("Admin: database cleanup", () => {
  let t, admin, user, other, handled;
  const post = (who, body) => t.http().post("/api/trips").set(who)
    .send({ destination: "Kunde", trip_type: "private", force: true, ...body });
  const report = async () => (await t.http().get("/api/admin/cleanup").set(admin)).body;

  before(async () => {
    t = await setup();
    admin = await t.login();
    user  = await t.registerUser("aufraeumen");
    other = await t.registerUser("aufraeumen2");

    // Double click: 3 × the same trip within seconds; the middle one was edited
    await post(user, { odometer_km: 100, timestamp: "2026-03-01T08:00:00.000Z" });
    handled = (await post(user, { odometer_km: 100, timestamp: "2026-03-01T08:00:00.400Z" })).body.id;
    await t.http().put(`/api/trips/${handled}`).set(user).send({ trip_type: "private" });
    await post(user, { odometer_km: 100, timestamp: "2026-03-01T08:00:02.000Z" });
    // not a duplicate: different destination / gap too large / different vehicle
    await post(user, { odometer_km: 100, timestamp: "2026-03-01T08:00:03.000Z", destination: "Anderes Ziel" });
    await post(user, { odometer_km: 100, timestamp: "2026-03-01T09:00:00.000Z" });
    await post(user, { odometer_km: 100, timestamp: "2026-03-01T08:00:01.000Z", vehicle_code: null });
    // trips without a vehicle for the second user
    await post(other, { odometer_km: 10, timestamp: "2026-03-02T08:00:00Z", vehicle_code: null });
    await post(other, { odometer_km: 20, timestamp: "2026-03-03T08:00:00Z", vehicle_code: null });
  });
  after(() => t.close());

  it("is admin-only", async () => {
    assert.equal((await t.http().get("/api/admin/cleanup").set(user)).status, 403);
    assert.equal((await t.http().post("/api/admin/cleanup/duplicates").set(user).send({})).status, 403);
  });

  it("finds duplicates and keeps the trip with history", async () => {
    const b = await report();
    assert.equal(b.duplicates.groups.length, 1);
    const g = b.duplicates.groups[0];
    assert.equal(g.username, "aufraeumen");
    assert.equal(g.keep.id, handled);
    assert.equal(g.remove.length, 2);
    assert.equal(b.duplicates.to_remove, 2);
  });

  it("lists trips without a vehicle per user along with their vehicles", async () => {
    const b = await report();
    assert.deepEqual(b.unassigned.map(o => [o.username, o.count]), [["aufraeumen", 1], ["aufraeumen2", 2]]);
    assert.equal(b.unassigned[1].vehicles[0].code, other.vehicle.code);
  });

  it("deletes only selected, actual duplicate trips and logs it", async () => {
    const g = (await report()).duplicates.groups[0];
    const res = await t.http().post("/api/admin/cleanup/duplicates").set(admin)
      .send({ ids: [g.remove[0].id, handled] });
    assert.deepEqual(res.body, { removed: 1, rejected: [handled] });

    const audit = await t.http().get("/api/audit?year=2026").set(user);
    assert.deepEqual(audit.body.filter(e => e.source === "admin").map(e => [e.trip_id, e.action]), [[g.remove[0].id, "delete"]]);

    const rest = await t.http().post("/api/admin/cleanup/duplicates").set(admin).send({});
    assert.equal(rest.body.removed, 1);
    assert.equal((await report()).duplicates.groups.length, 0);
  });

  it("assigns trips without a vehicle to one of the user's vehicles", async () => {
    const target = (await report()).unassigned.find(o => o.username === "aufraeumen2");
    const foreign = await t.http().post("/api/admin/cleanup/unassigned").set(admin)
      .send({ user_id: target.user_id, action: "assign", vehicle_id: user.vehicle.id });
    assert.equal(foreign.status, 400);
    assert.equal((await t.http().post("/api/admin/cleanup/unassigned").set(admin)
      .send({ user_id: target.user_id, action: "assign" })).status, 400);

    const res = await t.http().post("/api/admin/cleanup/unassigned").set(admin)
      .send({ user_id: target.user_id, action: "assign", vehicle_id: other.vehicle.id });
    assert.deepEqual(res.body, { count: 2 });

    const yearData = await t.http().get(`/api/trips?year=2026&vehicle=${other.vehicle.code}`).set(other);
    assert.equal(yearData.body.trips.length, 2);
    const history = await t.http().get(`/api/trips/${yearData.body.trips[0].id}/history`).set(other);
    assert.deepEqual(history.body.map(e => [e.action, e.source]), [["create", "web"], ["update", "admin"]]);
  });

  it("deletes trips without a vehicle on request", async () => {
    const target = (await report()).unassigned.find(o => o.username === "aufraeumen");
    const res = await t.http().post("/api/admin/cleanup/unassigned").set(admin)
      .send({ user_id: target.user_id, action: "delete" });
    assert.deepEqual(res.body, { count: 1 });
    assert.deepEqual((await report()).unassigned, []);
  });
});
