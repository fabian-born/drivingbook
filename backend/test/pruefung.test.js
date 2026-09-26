import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pruefeJahr } from "../src/lib/pruefung.js";
import { setup } from "./helpers.js";

const f = (id, odometer_km, distance, timestamp, previous_timestamp, destination = "Kunde") =>
  ({ id, odometer_km, distance, timestamp, previous_timestamp, destination });

describe("Check rules", () => {
  const jetzt = new Date("2026-12-31T00:00:00Z");

  it("is green without issues", () => {
    const r = pruefeJahr([
      f(1, 1000, null, "2026-01-01T08:00:00Z", null),
      f(2, 1050, 50,   "2026-01-02T08:00:00Z", "2026-01-01T08:00:00Z"),
    ], { jetzt });
    assert.deepEqual(r, { status: "green", findings: [] });
  });

  it("finds regressions, gaps, long distances, coordinates and future dates", () => {
    const r = pruefeJahr([
      f(1, 1000, 20,   "2026-01-01T08:00:00Z", "2025-12-30T08:00:00Z"),
      f(2, 900,  -100, "2026-01-02T08:00:00Z", "2026-01-01T08:00:00Z"),
      f(3, 1500, 600,  "2026-03-15T08:00:00Z", "2026-01-02T08:00:00Z"),       // 72 days, 600 km
      f(4, 2700, 1200, "2026-03-16T08:00:00Z", "2026-03-15T08:00:00Z"),
      f(5, 2710, 10,   "2026-03-17T08:00:00Z", "2026-03-16T08:00:00Z", "52.520008, 13.404954"),
      f(6, 2720, 10,   "2027-02-01T08:00:00Z", "2026-03-17T08:00:00Z"),
    ], { jetzt, geaendert: 2, geloescht: 1, ohneFahrzeug: 3 });

    assert.equal(r.status, "red");
    assert.deepEqual(r.findings.map(b => [b.type, b.trip_id]), [
      ["odometer_decrease", 2], ["gap", 3], ["long_distance", 4], ["coordinates", 5], ["future", 6],
      ["unassigned", undefined], ["edited", undefined], ["deleted", undefined],
    ]);
  });

  it("is yellow on warnings and reports empty years", () => {
    assert.equal(pruefeJahr([], { ohneFahrzeug: 1 }).status, "yellow");
    assert.equal(pruefeJahr([]).findings[0].type, "empty");
  });
});

describe("Check via API", () => {
  let t, user;
  before(async () => {
    t = await setup();
    user = await t.registerUser("pruefer");
    const post = body => t.http().post("/api/trips").set(user).send({ trip_type: "private", destination: "Kunde", ...body });
    await post({ odometer_km: 1000, timestamp: "2026-01-01T08:00:00Z" });
    const id = (await post({ odometer_km: 3000, timestamp: "2026-01-05T08:00:00Z" })).body.id;
    await t.http().put(`/api/trips/${id}`).set(user).send({ destination: "Neu" });
    await post({ odometer_km: 3010, timestamp: "2026-01-06T08:00:00Z", vehicle_code: null });
  });
  after(() => t.close());

  it("returns traffic light status and findings for a vehicle", async () => {
    const res = await t.http().get(`/api/vehicles/${user.vehicle.id}/check?year=2026`).set(user);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "yellow");
    assert.deepEqual(res.body.findings.map(b => b.type), ["long_distance", "unassigned", "edited"]);
  });

  it("protects foreign vehicles", async () => {
    const other = await t.registerUser("pruefer-fremd");
    assert.equal((await t.http().get(`/api/vehicles/${user.vehicle.id}/check`).set(other)).status, 404);
  });
});
