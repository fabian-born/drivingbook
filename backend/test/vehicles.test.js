import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

describe("Vehicle info", () => {
  let t, user, other, id;
  const post = body => t.http().post("/api/trips").set(user).send({ trip_type: "private", destination: "Ziel", ...body });

  before(async () => {
    t = await setup();
    user  = await t.registerUser("autoinfo");
    other = await t.registerUser("autoinfo-fremd");
    id = user.vehicle.id;
    await post({ odometer_km: 1000, timestamp: "2025-12-30T08:00:00Z" });
    await post({ odometer_km: 1100, timestamp: "2026-01-05T08:00:00Z", trip_type: "business" });  // 100 km, across the year boundary
    await post({ odometer_km: 1150, timestamp: "2026-02-01T08:00:00Z" });                            // 50 km private
  });
  after(() => t.close());

  it("updates vehicle data", async () => {
    const res = await t.http().patch(`/api/vehicles/${id}`).set(user)
      .send({ license_plate: "b-xy 42", list_price: "45990", drive_type: "electric" });
    assert.equal(res.status, 200);
    assert.equal(res.body.license_plate, "B-XY 42");
    assert.equal(res.body.list_price, 45990);
    assert.equal(res.body.drive_type, "electric");
    assert.equal((await t.http().patch(`/api/vehicles/${id}`).set(user).send({})).status, 400);
    assert.equal((await t.http().patch(`/api/vehicles/${id}`).set(other).send({ name: "x" })).status, 404);
  });

  it("returns yearly figures, no comparison without costs yet", async () => {
    const res = await t.http().get(`/api/vehicles/${id}/info?year=2026`).set(user);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.year_totals, { trips: 2, total: 150, business: 100, private: 50, commute: 0 });
    assert.equal(res.body.overall.trips, 3);
    assert.equal(res.body.overall.odometer_current, 1150);
    assert.equal(res.body.costs, null);
    assert.equal(res.body.comparison, null);
  });

  it("saves yearly costs and calculates the comparison", async () => {
    const put = await t.http().put(`/api/vehicles/${id}/years/2026`).set(user)
      .send({ total_costs: "9000", depreciation: "4000", months: 12 });
    assert.equal(put.status, 200);
    // saving again overwrites
    await t.http().put(`/api/vehicles/${id}/years/2026`).set(user).send({ total_costs: 9000, depreciation: 4000, tax_rate: 30 });

    const res = await t.http().get(`/api/vehicles/${id}/info?year=2026`).set(user);
    assert.equal(res.body.costs.tax_rate, 30);
    assert.equal(res.body.comparison.rate, 0.25);
    assert.equal(res.body.comparison.total_costs, 6000);
    assert.equal(res.body.comparison.logbook.total, 2000);   // 6.000 × 50/150
    assert.equal(res.body.comparison.flat_rate.total, 1377);
    assert.equal(res.body.comparison.recommendation, "flat_rate");
  });

  it("validates and protects foreign vehicles", async () => {
    assert.equal((await t.http().put(`/api/vehicles/${id}/years/2026`).set(user).send({ total_costs: "" })).status, 400);
    assert.equal((await t.http().put(`/api/vehicles/${id}/years/2026`).set(user).send({ total_costs: 1, months: 13 })).status, 400);
    assert.equal((await t.http().put(`/api/vehicles/${id}/years/2026`).set(other).send({ total_costs: 1 })).status, 404);
    assert.equal((await t.http().get(`/api/vehicles/${id}/info`).set(other)).status, 404);
  });

  it("shows the new fields in the vehicle list", async () => {
    const list = (await t.http().get("/api/vehicles").set(user)).body;
    assert.equal(list[0].drive_type, "electric");
    assert.equal(list[0].list_price, 45990);
  });

  it("deletes a vehicle with trips only given a target vehicle and logs the move", async () => {
    const second = (await t.http().post("/api/vehicles").set(user).send({ name: "Neuwagen" })).body;
    const withoutTarget = await t.http().delete(`/api/vehicles/${id}`).set(user);
    assert.equal(withoutTarget.status, 409);
    assert.equal(withoutTarget.body.code, "HAS_TRIPS");
    assert.equal(withoutTarget.body.count, 3);
    assert.equal((await t.http().delete(`/api/vehicles/${id}?target=${id}`).set(user)).status, 400);
    assert.equal((await t.http().delete(`/api/vehicles/${id}?target=${other.vehicle.id}`).set(user)).status, 400);

    const res = await t.http().delete(`/api/vehicles/${id}?target=${second.id}`).set(user);
    assert.deepEqual(res.body, { message: "Fahrzeug gelöscht", moved: 3 });
    const yearData = await t.http().get(`/api/trips?year=2026&vehicle=${second.code}`).set(user);
    assert.equal(yearData.body.trips.length, 2);
    const history = await t.http().get(`/api/trips/${yearData.body.trips[0].id}/history`).set(user);
    assert.equal(history.body.at(-1).new_data.vehicle_id, second.id);

    // a vehicle without trips can be deleted directly
    const empty = (await t.http().post("/api/vehicles").set(user).send({ name: "Leer" })).body;
    assert.equal((await t.http().delete(`/api/vehicles/${empty.id}`).set(user)).status, 200);
  });
});
