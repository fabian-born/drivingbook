import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

// supertest returns binary data as a Buffer only with a custom parser
const binary = (res, callback) => {
  const chunks = [];
  res.on("data", c => chunks.push(c));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};

describe("Export", () => {
  let t, user;
  const post = body => t.http().post("/api/trips").set(user).send(body);

  before(async () => {
    t = await setup();
    user = await t.registerUser("export");
    await post({ odometer_km: 100, destination: "Start", trip_type: "private", timestamp: "2025-12-20T08:00:00Z" });
    await post({ odometer_km: 150, destination: '=HYPERLINK("http://x") "Zitat"', trip_type: "business", timestamp: "2026-01-10T08:00:00Z" });
    const id = (await post({ odometer_km: 200, destination: "Kunde", trip_type: "private", timestamp: "2026-02-10T08:00:00Z" })).body.id;
    await t.http().put(`/api/trips/${id}`).set(user).send({ destination: "Kunde GmbH" });
  });
  after(() => t.close());

  it("returns 404 for months without trips", async () => {
    assert.equal((await t.http().get("/api/export/json?month=2026-08").set(user)).status, 404);
    assert.equal((await t.http().get("/api/export/json?month=2026-13").set(user)).status, 400);
  });

  it("escapes CSV fields and prevents formula injection", async () => {
    const res = await t.http().get("/api/export/csv/year/2026").set(user);
    assert.equal(res.status, 200);
    const lines = res.text.replace(/^﻿/, "").trim().split("\n");
    assert.equal(lines.length, 3);  // header + 2 trips from 2026
    assert.ok(lines[1].includes(`"'=HYPERLINK(""http://x"") ""Zitat"""`));
    assert.ok(lines[1].includes("10.01.2026 09:00"));  // German local time
    assert.ok(lines[2].endsWith(";ja"));               // modified afterwards
  });

  it("generates a PDF for a year", async () => {
    const res = await t.http().get("/api/export/pdf/year/2026").set(user).buffer(true).parse(binary);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(res.body.subarray(0, 5).toString(), "%PDF-");
    assert.ok(res.body.length > 1000);
  });

  it("generates a PDF even for empty years", async () => {
    const res = await t.http().get("/api/export/pdf/year/2030").set(user).buffer(true).parse(binary);
    assert.equal(res.status, 200);
    assert.equal(res.body.subarray(0, 5).toString(), "%PDF-");
  });

  it("restricts exports to one vehicle", async () => {
    const secondVehicle = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    await post({ odometer_km: 10, destination: "Zweitwagen", trip_type: "private", timestamp: "2026-01-15T08:00:00Z", vehicle_code: secondVehicle.code });

    const all  = await t.http().get("/api/export/json?month=2026-01").set(user);
    const onlySecond  = await t.http().get(`/api/export/json?month=2026-01&vehicle=${secondVehicle.code.toLowerCase()}`).set(user);
    const onlyFirst  = await t.http().get(`/api/export/json?month=2026-01&vehicle=${user.vehicle.code}`).set(user);
    assert.equal(all.body.length, 2);
    assert.deepEqual(onlySecond.body.map(f => f.destination), ["Zweitwagen"]);
    assert.equal(onlyFirst.body.length, 1);
    assert.notEqual(onlyFirst.body[0].destination, "Zweitwagen");

    const csv = await t.http().get(`/api/export/csv/year/2026?vehicle=${secondVehicle.code}`).set(user);
    assert.equal(csv.text.replace(/^\uFEFF/, "").trim().split("\n").length, 2);  // header + 1 trip

    const pdf = await t.http().get(`/api/export/pdf/year/2026?vehicle=${secondVehicle.code}`).set(user).buffer(true).parse(binary);
    assert.equal(pdf.status, 200);

    const empty = await t.http().get(`/api/export/json?month=2026-02&vehicle=${secondVehicle.code}`).set(user);
    assert.equal(empty.status, 404);
  });

  it("rejects foreign and invalid vehicle codes", async () => {
    const foreign = await t.registerUser("export-fremd");
    assert.equal((await t.http().get(`/api/export/json?month=2026-01&vehicle=${foreign.vehicle.code}`).set(user)).status, 404);
    assert.equal((await t.http().get("/api/export/json?month=2026-01&vehicle=xx").set(user)).status, 400);
    assert.equal((await t.http().get(`/api/audit?year=2026&vehicle=${foreign.vehicle.code}`).set(user)).status, 404);
  });

  it("requires authentication", async () => {
    assert.equal((await t.http().get("/api/export/pdf/year/2026")).status, 401);
  });
});

describe("Yearly trips", () => {
  let t, user;
  const post = body => t.http().post("/api/trips").set(user).send({ destination: "Ziel", trip_type: "private", ...body });

  before(async () => {
    t = await setup();
    user = await t.registerUser("jahr");
    await post({ odometer_km: 900,  timestamp: "2025-11-01T08:00:00Z" });
    await post({ odometer_km: 1000, timestamp: "2025-12-31T20:00:00Z" });
    await post({ odometer_km: 1100, timestamp: "2026-01-02T08:00:00Z", trip_type: "business" });
    await post({ odometer_km: 1150, timestamp: "2026-01-20T08:00:00Z" });
    await post({ odometer_km: 1400, timestamp: "2026-03-05T08:00:00Z", trip_type: "business" });
    const second = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    await post({ odometer_km: 50, timestamp: "2026-01-10T08:00:00Z", vehicle_code: second.code });
  });
  after(() => t.close());

  it("returns distances, months and total across the year boundary", async () => {
    const res = await t.http().get(`/api/trips?year=2026&vehicle=${user.vehicle.code}`).set(user);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.trips.map(f => f.distance), [100, 50, 250]);
    assert.deepEqual(res.body.months, [
      { month: "2026-01", start_km: 1000, end_km: 1150, trips: 2, total: 150, business: 100, private: 50, commute: 0 },
      { month: "2026-03", start_km: 1150, end_km: 1400, trips: 1, total: 250, business: 250, private: 0, commute: 0 },
    ]);
    assert.deepEqual(res.body.totals, { trips: 3, total: 400, business: 350, private: 50, commute: 0 });
    assert.ok(res.body.trips[0].id);
  });

  it("calculates per vehicle separately without a vehicle filter", async () => {
    const res = await t.http().get("/api/trips?year=2026").set(user);
    assert.equal(res.body.trips.length, 4);
    assert.equal(res.body.trips.find(f => f.odometer_km === 50).distance, null);  // first trip of the second vehicle
    assert.equal(res.body.totals.total, 400);
  });

  it("validates the year", async () => {
    assert.equal((await t.http().get("/api/trips").set(user)).status, 400);
    assert.deepEqual((await t.http().get("/api/trips?year=2030").set(user)).body.trips, []);
  });
});

describe("PDF calculates like dashboard and vehicle info", () => {
  let t, user;
  const post = body => t.http().post("/api/trips").set(user).send({ destination: "Ziel", trip_type: "private", force: true, ...body });

  before(async () => {
    t = await setup();
    user = await t.registerUser("pdf-gleich");
    await post({ odometer_km: 900,  timestamp: "2025-12-30T08:00:00Z" });
    await post({ odometer_km: 1000, timestamp: "2026-01-02T08:00:00Z", trip_type: "business" });
    await post({ odometer_km: 950,  timestamp: "2026-01-03T08:00:00Z" });                          // odometer regression
    await post({ odometer_km: 1200, timestamp: "2026-01-04T08:00:00Z", trip_type: "commute" });
  });
  after(() => t.close());

  it("returns the same totals, regressions count as 0", async () => {
    const { loadYearTrips } = await import("../src/lib/distances.js");
    const { vehicleSummary } = await import("../src/lib/pdf.js");

    const api = (await t.http().get(`/api/trips?year=2026&vehicle=${user.vehicle.code}`).set(user)).body;
    const userId = (await t.pool.query(`SELECT id FROM users WHERE username = 'pdf-gleich'`)).rows[0].id;
    const trips = await loadYearTrips(t.pool, { userId, year: 2026, vehicleId: null, timezone: "Europe/Berlin" });
    const [summary] = vehicleSummary(trips);

    assert.deepEqual(api.totals, { trips: 3, total: 350, business: 100, private: 0, commute: 250 });
    assert.equal(summary.total, api.totals.total);
    assert.equal(summary.private, api.totals.private);
    assert.equal(summary.startKm, 900);   // last reading before the year
    assert.equal(summary.endKm, 1200);
    assert.deepEqual(trips.map(f => f.distance), [100, -50, 250]);   // visible in the PDF

    const pdf = await t.http().get(`/api/export/pdf/year/2026?vehicle=${user.vehicle.code}`).set(user)
      .buffer(true).parse(binary);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  });
});
