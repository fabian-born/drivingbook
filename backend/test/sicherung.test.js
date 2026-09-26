import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";
import { ausAltformat } from "../scripts/convert-backup.js";

// Creates vehicle data, costs and trips incl. an edit and a deletion
async function testdaten(t, user) {
  const post = body => t.http().post("/api/trips").set(user).send({ trip_type: "private", destination: "Kunde", ...body });
  await t.http().patch(`/api/vehicles/${user.vehicle.id}`).set(user).send({ license_plate: "B-EX 1", list_price: 40000, drive_type: "hybrid" });
  await t.http().put(`/api/vehicles/${user.vehicle.id}/years/2026`).set(user).send({ total_costs: 7000, depreciation: 3000 });
  await post({ odometer_km: 100, timestamp: "2026-01-01T08:00:00Z" });
  const id2 = (await post({ odometer_km: 200, timestamp: "2026-01-02T08:00:00Z", trip_type: "commute" })).body.id;
  const id3 = (await post({ odometer_km: 300, timestamp: "2026-01-03T08:00:00Z" })).body.id;
  await t.http().put(`/api/trips/${id2}`).set(user).send({ destination: "Büro" });
  await t.http().delete(`/api/trips/${id3}`).set(user);
}

describe("Vehicle backup", () => {
  let t, user, datei;

  before(async () => {
    t = await setup();
    user = await t.registerUser("sicherung");
    await testdaten(t, user);
    // a trip of another vehicle must not end up in the backup
    const zweit = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    await t.http().post("/api/trips").set(user).send({ odometer_km: 5, destination: "x", trip_type: "private", timestamp: "2026-01-04T08:00:00Z", vehicle_code: zweit.code });
  });
  after(() => t.close());

  it("backs up vehicle, yearly costs, trips and audit log", async () => {
    const res = await t.http().get(`/api/vehicles/${user.vehicle.id}/export`).set(user);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /attachment; filename="fahrzeug_[A-Z0-9]{6}_\d{4}-\d{2}-\d{2}\.json"/);
    datei = res.body;
    assert.equal(datei.format, "drivingbook-vehicle");
    assert.equal(datei.version, 2);
    assert.equal(datei.vehicle.license_plate, "B-EX 1");
    assert.equal(datei.years[0].total_costs, 7000);
    assert.deepEqual(datei.trips.map(f => f.odometer_km), [100, 200]);
    assert.deepEqual(datei.audit.map(e => e.action), ["create", "create", "create", "update", "delete"]);
  });

  it("restores only what is missing", async () => {
    // one trip "lost", audit log remains
    const jahr = await t.http().get(`/api/trips?year=2026&vehicle=${user.vehicle.code}`).set(user);
    await t.pool.query(`DELETE FROM trips WHERE id = $1`, [jahr.body.trips[1].id]);

    const res = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.equal(res.status, 200);
    assert.equal(res.body.created, false);
    assert.equal(res.body.vehicle.code, user.vehicle.code);
    assert.deepEqual(res.body.imported, { trips: 1, reassigned: 0, skipped: 1, years: 0, audit: 0 });

    const nachher = await t.http().get(`/api/trips?year=2026&vehicle=${user.vehicle.code}`).set(user);
    assert.deepEqual(nachher.body.trips.map(f => f.destination), ["Kunde", "Büro"]);

    // second time: nothing left to do
    const nochmal = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.deepEqual(nochmal.body.imported, { trips: 0, reassigned: 0, skipped: 2, years: 0, audit: 0 });
  });

  it("recreates a deleted vehicle with the same code and reassigns its trips", async () => {
    // legacy data: vehicle deleted directly, trips were left without a vehicle (ON DELETE SET NULL)
    await t.pool.query(`DELETE FROM vehicles WHERE id = $1`, [user.vehicle.id]);

    const res = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.equal(res.status, 201);
    assert.equal(res.body.created, true);
    assert.equal(res.body.vehicle.code, datei.vehicle.code);
    assert.equal(res.body.vehicle.drive_type, "hybrid");
    assert.deepEqual(res.body.imported, { trips: 0, reassigned: 2, skipped: 0, years: 1, audit: 0 });

    const jahr = await t.http().get(`/api/trips?year=2026&vehicle=${res.body.vehicle.code}`).set(user);
    assert.deepEqual(jahr.body.trips.map(f => f.destination), ["Kunde", "Büro"]);
    const buero = jahr.body.trips.find(f => f.destination === "Büro");
    const verlauf = await t.http().get(`/api/trips/${buero.id}/history`).set(user);
    assert.deepEqual(verlauf.body.map(e => [e.action, e.source]), [["create", "web"], ["update", "web"]]);
    assert.equal(verlauf.body[1].new_data.vehicle_id, res.body.vehicle.id);
  });

  it("restores everything after total loss with an unchanged audit log", async () => {
    const vehicle = (await t.http().get("/api/vehicles").set(user)).body.find(v => v.code === datei.vehicle.code);
    await t.pool.query(`DELETE FROM trips WHERE vehicle_id = $1`, [vehicle.id]);
    await t.pool.query(`DELETE FROM vehicles WHERE id = $1`, [vehicle.id]);
    await t.pool.query(`DELETE FROM trip_audit`);

    const res = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.deepEqual(res.body.imported, { trips: 2, reassigned: 0, skipped: 0, years: 1, audit: 5 });

    // deleted trip stays visible in the yearly log, sources unchanged
    const audit = await t.http().get(`/api/audit?year=2026&vehicle=${res.body.vehicle.code}`).set(user);
    assert.deepEqual(audit.body.map(e => [e.action, e.source]), [["delete", "web"], ["update", "web"]]);
  });

  it("does not duplicate trips that now belong to another vehicle", async () => {
    const vehicle = (await t.http().get("/api/vehicles").set(user)).body.find(v => v.code === datei.vehicle.code);
    const zweit   = (await t.http().get("/api/vehicles").set(user)).body.find(v => v.name === "Zweitwagen");
    const res = await t.http().delete(`/api/vehicles/${vehicle.id}?target=${zweit.id}`).set(user);
    assert.equal(res.body.moved, 2);

    const wieder = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.equal(wieder.body.created, true);
    assert.deepEqual(wieder.body.imported, { trips: 0, reassigned: 0, skipped: 2, years: 1, audit: 0 });
  });

  it("does not use foreign or oversized trip IDs and does not break the ID sequence", async () => {
    const vorher = (await t.pool.query(`SELECT last_value FROM trips_id_seq`)).rows[0].last_value;
    const fremd = { ...datei, vehicle: { ...datei.vehicle, code: null, name: "Präpariert" }, audit: [],
      trips: [{ id: 2147483000, odometer_km: 99999, destination: "x", trip_type: "private", timestamp: "2030-01-01T00:00:00Z" }] };
    const res = await t.http().post("/api/vehicles/import").set(user).send(fremd);
    assert.equal(res.status, 201);
    const neu = (await t.pool.query(`SELECT id FROM trips WHERE odometer_km = 99999`)).rows[0].id;
    assert.ok(neu < 2147483000);
    const nachher = (await t.pool.query(`SELECT last_value FROM trips_id_seq`)).rows[0].last_value;
    assert.ok(Number(nachher) - Number(vorher) <= 1);

    // new trips still work
    const ok = await t.http().post("/api/trips").set(user)
      .send({ odometer_km: 100000, destination: "danach", trip_type: "private", timestamp: "2030-02-01T00:00:00Z", force: true });
    assert.equal(ok.status, 200);
  });

  it("rejects invalid audit log data", async () => {
    const kaputt = { ...datei, audit: [{ trip_id: 1, action: "update", old_data: { timestamp: "kaputt" }, changed_at: "2026-01-01T00:00:00Z" }] };
    assert.equal((await t.http().post("/api/vehicles/import").set(user).send(kaputt)).status, 400);
  });

  it("rejects the old v1 format and restores it after convert-backup.js", async () => {
    const ziel = await t.registerUser("sicherung-v1");
    const v1 = {
      format: "drivingbook-fahrzeug", version: 1, exportiert_am: "2026-09-25T10:00:00Z",
      fahrzeug: { id: 77, name: "Altwagen", code: null, license_plate: "B-AL 1", list_price: 30000, drive_type: "elektro" },
      jahre: [{ year: 2026, total_costs: 5000, depreciation: 1000 }],
      fahrten: [
        { id: 501, kmstand: 100, ziel: "Kunde", fahrtart: "geschäftlich", timestamp: "2026-04-01T08:00:00Z" },
        { id: 502, kmstand: 160, ziel: "Büro",  fahrtart: "arbeitsweg",   timestamp: "2026-04-02T08:00:00Z" },
      ],
      protokoll: [
        { fahrt_id: 501, action: "create", old_data: null,
          new_data: { kmstand: 100, ziel: "Kunde", fahrtart: "privat", timestamp: "2026-04-01T08:00:00Z", vehicle_id: 77 },
          source: "web", changed_at: "2026-04-01T08:00:01Z" },
        { fahrt_id: 501, action: "update",
          old_data: { kmstand: 100, ziel: "Kunde", fahrtart: "privat", timestamp: "2026-04-01T08:00:00Z", vehicle_id: 77 },
          new_data: { kmstand: 100, ziel: "Kunde", fahrtart: "geschäftlich", timestamp: "2026-04-01T08:00:00Z", vehicle_id: 77 },
          source: "web", changed_at: "2026-04-01T09:00:00Z" },
      ],
    };
    const alt = await t.http().post("/api/vehicles/import").set(ziel).send(v1);
    assert.equal(alt.status, 400);
    assert.match(alt.body.error, /convert-backup\.js/);

    const res = await t.http().post("/api/vehicles/import").set(ziel).send(ausAltformat(v1));
    assert.equal(res.status, 201);
    assert.equal(res.body.vehicle.drive_type, "electric");
    assert.deepEqual(res.body.imported, { trips: 2, reassigned: 0, skipped: 0, years: 1, audit: 2 });

    const jahr = await t.http().get(`/api/trips?year=2026&vehicle=${res.body.vehicle.code}`).set(ziel);
    assert.deepEqual(jahr.body.trips.map(f => [f.odometer_km, f.destination, f.trip_type]), [[100, "Kunde", "business"], [160, "Büro", "commute"]]);
    const verlauf = await t.http().get(`/api/trips/${jahr.body.trips[0].id}/history`).set(ziel);
    assert.deepEqual(verlauf.body[1].old_data, {
      odometer_km: 100, destination: "Kunde", trip_type: "private", timestamp: "2026-04-01T08:00:00.000Z", vehicle_id: res.body.vehicle.id,
    });
  });

  it("rejects invalid files", async () => {
    assert.equal((await t.http().post("/api/vehicles/import").set(user).send({ foo: 1 })).status, 400);
    assert.equal((await t.http().post("/api/vehicles/import").set(user).send({ ...datei, version: 3 })).status, 400);
    assert.equal((await t.http().post("/api/vehicles/import").set(user)
      .send({ ...datei, trips: [{ id: 1, odometer_km: -1, destination: "x", trip_type: "private", timestamp: "2026-01-01" }] })).status, 400);
    const fremd = await t.registerUser("sicherung-fremd");
    assert.equal((await t.http().get(`/api/vehicles/${fremd.vehicle.id}/export`).set(user)).status, 404);
  });
});

describe("Full backup", () => {
  let t, user, sicherung, zweitCode;

  before(async () => {
    t = await setup();
    user = await t.registerUser("gesamt");
    await testdaten(t, user);
    const zweit = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    zweitCode = zweit.code;
    await t.http().post("/api/trips").set(user).send({ odometer_km: 5, destination: "Zweit", trip_type: "private", timestamp: "2026-01-04T08:00:00Z", vehicle_code: zweit.code });
    await t.http().post("/api/trips").set(user).send({ odometer_km: 7, destination: "Ohne", trip_type: "private", timestamp: "2026-01-05T08:00:00Z", vehicle_code: null });
  });
  after(() => t.close());

  it("reminds about a backup when it is older than 30 days and there are changes", async () => {
    await t.pool.query(`UPDATE vehicles SET created_at = NOW() - INTERVAL '40 days'`);
    const vorher = await t.http().get("/api/backup/status").set(user);
    assert.equal(vorher.body.remind, true);
    assert.equal(vorher.body.vehicles[0].last_backup_at, null);
    assert.ok(vorher.body.vehicles[0].changes > 0);
  });

  it("backs up all vehicles and trips without a vehicle", async () => {
    const res = await t.http().get("/api/backup").set(user);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /fahrtenbuch_sicherung_\d{4}-\d{2}-\d{2}\.json/);
    sicherung = res.body;
    assert.equal(sicherung.format, "drivingbook-backup");
    assert.deepEqual(sicherung.vehicles.map(f => f.trips.length), [2, 1]);
    assert.deepEqual(sicherung.unassigned.trips.map(f => f.destination), ["Ohne"]);

    const status = await t.http().get("/api/backup/status").set(user);
    assert.equal(status.body.remind, false);
    assert.ok(status.body.vehicles.every(f => f.last_backup_at && f.changes === 0));
  });

  it("restores everything after data loss without duplicates", async () => {
    await t.pool.query(`DELETE FROM vehicles WHERE code = $1`, [zweitCode]);
    await t.pool.query(`DELETE FROM trips WHERE user_id = (SELECT id FROM users WHERE username = 'gesamt') AND destination IN ('Zweit', 'Ohne')`);

    const res = await t.http().post("/api/backup/restore").set(user).send(sicherung);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.vehicles.map(f => [f.name, f.created, f.trips, f.skipped]),
      [["Fahrzeug 1", false, 0, 2], ["Zweitwagen", true, 1, 0]]);
    assert.equal(res.body.unassigned.trips, 1);

    const vehicles = (await t.http().get("/api/vehicles").set(user)).body;
    assert.ok(vehicles.some(v => v.code === zweitCode));

    const nochmal = await t.http().post("/api/backup/restore").set(user).send(sicherung);
    assert.ok(nochmal.body.vehicles.every(f => f.trips === 0 && f.audit === 0));
    assert.equal(nochmal.body.unassigned.trips, 0);
  });

  it("rejects a vehicle backup at the full backup endpoint", async () => {
    const res = await t.http().post("/api/backup/restore").set(user).send({ format: "drivingbook-vehicle", version: 2 });
    assert.equal(res.status, 400);
  });

  it("accepts large backups, other endpoints stay limited", async () => {
    const viele = Array.from({ length: 3000 }, (_, i) => ({
      id: i + 1, odometer_km: 10000 + i, destination: "Langer Zielname ".repeat(5), trip_type: "private",
      timestamp: new Date(Date.UTC(2020, 0, 1) + i * 3600e3).toISOString(),
    }));
    const gross = { ...sicherung, vehicles: [{ ...sicherung.vehicles[0], trips: viele, audit: [] }] };
    const res = await t.http().post("/api/backup/restore").set(user).send(gross);
    assert.equal(res.status, 200);
    assert.equal(res.body.vehicles[0].trips, 3000);

    // sequence is past the reused IDs → new trips work
    const neu = await t.http().post("/api/trips").set(user)
      .send({ odometer_km: 99999, destination: "Danach", trip_type: "private", timestamp: "2030-01-01T08:00:00Z", force: true });
    assert.equal(neu.status, 200);

    const zuGross = await t.http().post("/api/trips").set(user).send({ destination: "x".repeat(200_000) });
    assert.equal(zuGross.status, 413);
  });
});
