import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

describe("Export/Import eines Fahrzeugs", () => {
  let t, quelle, ziel, datei;

  before(async () => {
    t = await setup();
    quelle = await t.registerUser("export-quelle");
    ziel   = await t.registerUser("export-ziel");

    const post = body => t.http().post("/api/fahrt").set(quelle).send({ fahrtart: "privat", ziel: "Kunde", ...body });
    await t.http().patch(`/api/vehicles/${quelle.vehicle.id}`).set(quelle).send({ license_plate: "B-EX 1", list_price: 40000, drive_type: "hybrid" });
    await t.http().put(`/api/vehicles/${quelle.vehicle.id}/years/2026`).set(quelle).send({ total_costs: 7000, depreciation: 3000 });
    await post({ kmstand: 100, timestamp: "2026-01-01T08:00:00Z" });
    const id2 = (await post({ kmstand: 200, timestamp: "2026-01-02T08:00:00Z", fahrtart: "arbeitsweg" })).body.id;
    const id3 = (await post({ kmstand: 300, timestamp: "2026-01-03T08:00:00Z" })).body.id;
    await t.http().put(`/api/fahrt/${id2}`).set(quelle).send({ ziel: "Büro" });
    await t.http().delete(`/api/fahrt/${id3}`).set(quelle);
    // Fahrt eines anderen Fahrzeugs darf nicht im Export landen
    const zweit = (await t.http().post("/api/vehicles").set(quelle).send({ name: "Zweitwagen" })).body;
    await post({ kmstand: 5, timestamp: "2026-01-04T08:00:00Z", vehicle_code: zweit.code });
  });
  after(() => t.close());

  it("exportiert Fahrzeug, Jahreskosten, Fahrten und Protokoll", async () => {
    const res = await t.http().get(`/api/vehicles/${quelle.vehicle.id}/export`).set(quelle);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /attachment; filename="fahrzeug_[A-Z0-9]{6}_\d{4}-\d{2}-\d{2}\.json"/);
    datei = res.body;
    assert.equal(datei.format, "drivingbook-fahrzeug");
    assert.equal(datei.fahrzeug.license_plate, "B-EX 1");
    assert.equal(datei.jahre[0].total_costs, 7000);
    assert.deepEqual(datei.fahrten.map(f => f.kmstand), [100, 200]);
    assert.deepEqual(datei.protokoll.map(e => e.action), ["create", "create", "create", "update", "delete"]);
  });

  it("importiert als neues Fahrzeug bei einem anderen User", async () => {
    // Code ist beim Quell-User vergeben → neuer Code
    const res = await t.http().post("/api/vehicles/import").set(ziel).send(datei);
    assert.equal(res.status, 201);
    assert.notEqual(res.body.vehicle.code, datei.fahrzeug.code);
    assert.equal(res.body.vehicle.drive_type, "hybrid");
    assert.deepEqual(res.body.importiert, { fahrten: 2, uebersprungen: 0, jahre: 1, protokoll: 5 });

    const jahr = await t.http().get(`/api/fahrten?year=2026&vehicle=${res.body.vehicle.code}`).set(ziel);
    assert.deepEqual(jahr.body.fahrten.map(f => [f.ziel, f.fahrtart, f.edited]), [["Kunde", "privat", false], ["Büro", "arbeitsweg", true]]);

    const verlauf = await t.http().get(`/api/fahrt/${jahr.body.fahrten[1]._id}/history`).set(ziel);
    assert.deepEqual(verlauf.body.map(e => [e.action, e.source]), [["create", "import:web"], ["update", "import:web"]]);
    assert.equal(verlauf.body[1].new_data.vehicle_id, res.body.vehicle.id);

    // gelöschte Fahrt bleibt im Jahresprotokoll sichtbar
    const audit = await t.http().get(`/api/audit?year=2026&vehicle=${res.body.vehicle.code}`).set(ziel);
    assert.deepEqual(audit.body.map(e => e.action), ["delete", "update"]);
  });

  it("überspringt beim Zusammenführen vorhandene Fahrten", async () => {
    const neu = { ...datei, fahrten: [...datei.fahrten, { id: 999999, kmstand: 400, ziel: "Neu", fahrtart: "privat", timestamp: "2026-02-01T08:00:00Z" }] };
    const res = await t.http().post(`/api/vehicles/import?vehicle=${quelle.vehicle.code}`).set(quelle).send(neu);
    assert.equal(res.status, 200);
    // nur der Import-Eintrag der neuen Fahrt; der Verlauf der gelöschten Fahrt existiert schon
    assert.deepEqual(res.body.importiert, { fahrten: 1, uebersprungen: 2, jahre: 0, protokoll: 1 });

    const verlauf = await t.http().get(`/api/fahrten?year=2026&vehicle=${quelle.vehicle.code}`).set(quelle);
    const neueFahrt = verlauf.body.fahrten.find(f => f.ziel === "Neu");
    const history = await t.http().get(`/api/fahrt/${neueFahrt._id}/history`).set(quelle);
    assert.deepEqual(history.body.map(e => e.source), ["import"]);
  });

  it("behält den Code, wenn er frei ist", async () => {
    await t.http().delete(`/api/vehicles/${quelle.vehicle.id}`).set(quelle);
    const res = await t.http().post("/api/vehicles/import").set(quelle).send(datei);
    assert.equal(res.body.vehicle.code, datei.fahrzeug.code);
  });

  it("lehnt ungültige Dateien und fremde Fahrzeuge ab", async () => {
    assert.equal((await t.http().post("/api/vehicles/import").set(ziel).send({ foo: 1 })).status, 400);
    assert.equal((await t.http().post("/api/vehicles/import").set(ziel).send({ ...datei, version: 2 })).status, 400);
    assert.equal((await t.http().post("/api/vehicles/import").set(ziel)
      .send({ ...datei, fahrten: [{ id: 1, kmstand: -1, ziel: "x", fahrtart: "privat", timestamp: "2026-01-01" }] })).status, 400);
    assert.equal((await t.http().get(`/api/vehicles/${ziel.vehicle.id}/export`).set(quelle)).status, 404);
    assert.equal((await t.http().post(`/api/vehicles/import?vehicle=${ziel.vehicle.code}`).set(quelle).send(datei)).status, 404);
  });

  it("akzeptiert große Importdateien, andere Endpunkte bleiben begrenzt", async () => {
    const viele = Array.from({ length: 3000 }, (_, i) => ({
      id: i + 1, kmstand: 10000 + i, ziel: "Langer Zielname ".repeat(5), fahrtart: "privat",
      timestamp: new Date(Date.UTC(2020, 0, 1) + i * 3600e3).toISOString(),
    }));
    const res = await t.http().post("/api/vehicles/import").set(ziel).send({ ...datei, fahrten: viele, protokoll: [] });
    assert.equal(res.status, 201);
    assert.equal(res.body.importiert.fahrten, 3000);

    const gross = await t.http().post("/api/fahrt").set(ziel).send({ ziel: "x".repeat(200_000) });
    assert.equal(gross.status, 413);
  });
});
