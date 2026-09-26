import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

const trip = (odometer_km, timestamp, extra = {}) =>
  ({ odometer_km, destination: `Ziel ${odometer_km}`, trip_type: "private", timestamp, ...extra });

describe("Trips", () => {
  let t, user, other;
  const post = body => t.http().post("/api/trips").set(user).send(body);
  const month = m => t.http().get(`/api/export/json?month=${m}`).set(user);

  before(async () => {
    t = await setup();
    user  = await t.registerUser("fahrer");
    other = await t.registerUser("fremd");
  });
  after(() => t.close());

  it("validates new trips", async () => {
    const cases = [
      [trip("abc", "2026-01-01T08:00:00Z"), /km-Stand/],
      [trip(-5, "2026-01-01T08:00:00Z"), /km-Stand/],
      [trip(100, "2026-01-01T08:00:00Z", { destination: "  " }), /Ziel/],
      [trip(100, "2026-01-01T08:00:00Z", { trip_type: "dienstlich" }), /Fahrtart/],
      [trip(100, "gestern"), /Zeitpunkt/],
    ];
    for (const [body, msg] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(res.body.error, msg);
    }
  });

  it("accepts odometer_km as a string (form) but not foreign vehicles", async () => {
    const ok = await post(trip("1000", "2026-01-05T08:00:00Z"));
    assert.equal(ok.status, 200);

    const foreign = await post(trip(1100, "2026-01-06T08:00:00Z", { vehicle_code: other.vehicle.code }));
    assert.equal(foreign.status, 404);
  });

  it("edits the correct trip by ID even when the order changes", async () => {
    const b = (await post(trip(1200, "2026-01-10T08:00:00Z"))).body.id;
    // insert an earlier trip afterwards → positions shift
    await post(trip(900, "2026-01-02T08:00:00Z"));

    const res = await t.http().put(`/api/trips/${b}`).set(user).send({ destination: "Geändert" });
    assert.equal(res.status, 200);

    const list = (await month("2026-01")).body;
    assert.equal(list.find(f => f.id === b).destination, "Geändert");
    assert.equal(list.filter(f => f.destination === "Geändert").length, 1);
  });

  it("allows partial updates with odometer_km 0 and vehicle_id null (with force)", async () => {
    // Precedes all other trips so that odometer reading 0 does not affect plausibility in later tests
    // (force needed since earlier trips without vehicle_code now also use the default vehicle)
    const id = (await post(trip(5000, "2020-02-01T08:00:00Z", { vehicle_code: user.vehicle.code, force: true }))).body.id;
    const res = await t.http().put(`/api/trips/${id}`).set(user).send({ odometer_km: 0, vehicle_code: null, force: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.trip.odometer_km, 0);
    assert.equal(res.body.trip.vehicle_id, null);
  });

  it("rejects empty updates, invalid IDs and foreign trips", async () => {
    const id = (await post(trip(1300, "2026-01-15T08:00:00Z"))).body.id;
    assert.equal((await t.http().put(`/api/trips/${id}`).set(user).send({})).status, 400);
    assert.equal((await t.http().put("/api/trips/abc").set(user).send({ destination: "x" })).status, 400);
    assert.equal((await t.http().put(`/api/trips/${id}`).set(other).send({ destination: "x" })).status, 404);
    assert.equal((await t.http().delete(`/api/trips/${id}`).set(other)).status, 404);
  });

  it("no longer has the old index routes", async () => {
    const res = await t.http().put("/api/trips/2026-01/0").set(user).send({ destination: "x" });
    assert.equal(res.status, 404);
  });

  it("assigns months by German local time", async () => {
    // 31.03. 22:30 UTC = 01.04. 00:30 summer time
    const id = (await post(trip(20000, "2026-03-31T22:30:00Z", { vehicle_code: user.vehicle.code }))).body.id;
    const april = (await month("2026-04")).body;
    assert.ok(april.some(f => f.id === id));

    // moving via PUT: the new month is in the response
    const moved = await t.http().put(`/api/trips/${id}`).set(user).send({ timestamp: "2026-05-10T10:00:00Z" });
    assert.equal(moved.body.trip.month, "2026-05");
  });

  it("does not store an identical trip twice (offline queue re-sends)", async () => {
    const body = trip(30000, "2026-08-01T08:00:00.123Z", { vehicle_code: user.vehicle.code });
    const first  = await post(body);
    const second = await post(body);
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);
    const list = (await month("2026-08")).body;
    assert.equal(list.filter(f => f.odometer_km === 30000).length, 1);
    // a different time is a new trip
    assert.notEqual((await post({ ...body, timestamp: "2026-08-01T08:00:01.123Z" })).body.id, first.body.id);
  });

  it("deletes by ID", async () => {
    const id = (await post(trip(1400, "2026-01-20T08:00:00Z"))).body.id;
    assert.equal((await t.http().delete(`/api/trips/${id}`).set(user)).status, 200);
    assert.ok(!(await month("2026-01")).body.some(f => f.id === id));
  });
});

describe("Odometer plausibility", () => {
  let t, user, vcode;
  const post = body => t.http().post("/api/trips").set(user).send({ vehicle_code: vcode, ...body });

  before(async () => {
    t = await setup();
    user = await t.registerUser("plausi");
    vcode = user.vehicle.code;
    await post(trip(1000, "2026-06-01T08:00:00Z"));
    await post(trip(2000, "2026-06-10T08:00:00Z"));
  });
  after(() => t.close());

  it("rejects odometer readings lower than the previous trip", async () => {
    const res = await post(trip(900, "2026-06-05T08:00:00Z"));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "KM_PLAUSIBILITY");
  });

  it("rejects odometer readings higher than the following trip", async () => {
    const res = await post(trip(2500, "2026-06-05T08:00:00Z"));
    assert.equal(res.status, 409);
  });

  it("accepts matching values and force", async () => {
    assert.equal((await post(trip(1500, "2026-06-05T08:00:00Z"))).status, 200);
    assert.equal((await post({ ...trip(10, "2026-06-06T08:00:00Z"), force: true })).status, 200);
  });

  it("checks each vehicle separately", async () => {
    const secondVehicle = await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" });
    const res = await t.http().post("/api/trips").set(user)
      .send({ ...trip(50, "2026-06-07T08:00:00Z"), vehicle_code: secondVehicle.body.code });
    assert.equal(res.status, 200);
  });
});

describe("Audit log", () => {
  let t, user, id;

  before(async () => {
    t = await setup();
    user = await t.registerUser("audit");
    id = (await t.http().post("/api/trips").set(user).send(trip(100, "2026-07-01T08:00:00Z"))).body.id;
    await t.http().put(`/api/trips/${id}`).set(user).send({ destination: "Neu" });
  });
  after(() => t.close());

  it("logs creation and changes with old and new values", async () => {
    const res = await t.http().get(`/api/trips/${id}/history`).set(user);
    assert.deepEqual(res.body.map(e => e.action), ["create", "update"]);
    assert.equal(res.body[1].old_data.destination, "Ziel 100");
    assert.equal(res.body[1].new_data.destination, "Neu");
    assert.equal(res.body[1].source, "web");
  });

  it("marks modified trips in the export", async () => {
    const list = (await t.http().get("/api/export/json?month=2026-07").set(user)).body;
    assert.equal(list[0].edited, true);
  });

  it("keeps deletions in the yearly log and records the source", async () => {
    await t.http().delete(`/api/trips/${id}`).set("X-API-Token", user.apiToken).expect(200);
    const res = await t.http().get("/api/audit?year=2026").set(user);
    assert.deepEqual(res.body.map(e => e.action), ["delete", "update"]);
    assert.equal(res.body[0].old_data.destination, "Neu");
    assert.equal(res.body[0].source, "api_token");
  });

  it("filters the yearly log by vehicle", async () => {
    const secondVehicle = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    const forFirst = await t.http().get(`/api/audit?year=2026&vehicle=${user.vehicle.code}`).set(user);
    const forSecond = await t.http().get(`/api/audit?year=2026&vehicle=${secondVehicle.code}`).set(user);
    assert.equal(forFirst.body.length, 2);
    assert.deepEqual(forSecond.body, []);
  });

  it("does not show other users' logs", async () => {
    const other = await t.registerUser("neugierig");
    assert.equal((await t.http().get(`/api/trips/${id}/history`).set(other)).status, 404);
    assert.deepEqual((await t.http().get("/api/audit?year=2026").set(other)).body, []);
  });
});

describe("Trip type commute", () => {
  let t, user;
  const post = body => t.http().post("/api/trips").set(user).send(body);
  before(async () => {
    t = await setup();
    user = await t.registerUser("pendler");
  });
  after(() => t.close());

  it("no longer has the former German route POST /api/fahrt", async () => {
    const res = await t.http().post("/api/fahrt").set("X-API-Token", user.apiToken)
      .send({ kmstand: 40, ziel: "Home Assistant", fahrtart: "geschäftlich", timestamp: "2027-02-01T08:00:00Z" });
    assert.equal(res.status, 404);
  });

  it("supports the commute trip type and counts it separately", async () => {
    const res = await post(trip(5, "2027-01-02T08:00:00Z", { trip_type: "commute" }));
    assert.equal(res.status, 200);
    await post(trip(25, "2027-01-03T08:00:00Z", { trip_type: "commute" }));
    const yearData = await t.http().get(`/api/trips?year=2027&vehicle=${user.vehicle.code}`).set(user);
    assert.equal(yearData.body.totals.commute, 20);
    assert.equal((await post(trip(30, "2027-01-04T08:00:00Z", { trip_type: "urlaub" }))).status, 400);
  });

});
