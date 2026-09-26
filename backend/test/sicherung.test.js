import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

// Legt Fahrzeugdaten, Kosten und Fahrten inkl. Änderung und Löschung an
async function testdaten(t, user) {
  const post = body => t.http().post("/api/fahrt").set(user).send({ fahrtart: "privat", ziel: "Kunde", ...body });
  await t.http().patch(`/api/vehicles/${user.vehicle.id}`).set(user).send({ license_plate: "B-EX 1", list_price: 40000, drive_type: "hybrid" });
  await t.http().put(`/api/vehicles/${user.vehicle.id}/years/2026`).set(user).send({ total_costs: 7000, depreciation: 3000 });
  await post({ kmstand: 100, timestamp: "2026-01-01T08:00:00Z" });
  const id2 = (await post({ kmstand: 200, timestamp: "2026-01-02T08:00:00Z", fahrtart: "arbeitsweg" })).body.id;
  const id3 = (await post({ kmstand: 300, timestamp: "2026-01-03T08:00:00Z" })).body.id;
  await t.http().put(`/api/fahrt/${id2}`).set(user).send({ ziel: "Büro" });
  await t.http().delete(`/api/fahrt/${id3}`).set(user);
}

describe("Fahrzeug-Sicherung", () => {
  let t, user, datei;

  before(async () => {
    t = await setup();
    user = await t.registerUser("sicherung");
    await testdaten(t, user);
    // Fahrt eines anderen Fahrzeugs darf nicht in der Sicherung landen
    const zweit = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    await t.http().post("/api/fahrt").set(user).send({ kmstand: 5, ziel: "x", fahrtart: "privat", timestamp: "2026-01-04T08:00:00Z", vehicle_code: zweit.code });
  });
  after(() => t.close());

  it("sichert Fahrzeug, Jahreskosten, Fahrten und Protokoll", async () => {
    const res = await t.http().get(`/api/vehicles/${user.vehicle.id}/export`).set(user);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /attachment; filename="fahrzeug_[A-Z0-9]{6}_\d{4}-\d{2}-\d{2}\.json"/);
    datei = res.body;
    assert.equal(datei.format, "drivingbook-fahrzeug");
    assert.equal(datei.fahrzeug.license_plate, "B-EX 1");
    assert.equal(datei.jahre[0].total_costs, 7000);
    assert.deepEqual(datei.fahrten.map(f => f.kmstand), [100, 200]);
    assert.deepEqual(datei.protokoll.map(e => e.action), ["create", "create", "create", "update", "delete"]);
  });

  it("ergänzt beim Wiederherstellen nur, was fehlt", async () => {
    // eine Fahrt „verloren“, Protokoll bleibt
    const jahr = await t.http().get(`/api/fahrten?year=2026&vehicle=${user.vehicle.code}`).set(user);
    await t.pool.query(`DELETE FROM fahrten WHERE id = $1`, [jahr.body.fahrten[1]._id]);

    const res = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.equal(res.status, 200);
    assert.equal(res.body.neu, false);
    assert.equal(res.body.vehicle.code, user.vehicle.code);
    assert.deepEqual(res.body.importiert, { fahrten: 1, zugeordnet: 0, uebersprungen: 1, jahre: 0, protokoll: 0 });

    const nachher = await t.http().get(`/api/fahrten?year=2026&vehicle=${user.vehicle.code}`).set(user);
    assert.deepEqual(nachher.body.fahrten.map(f => f.ziel), ["Kunde", "Büro"]);

    // zweites Mal: nichts mehr zu tun
    const nochmal = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.deepEqual(nochmal.body.importiert, { fahrten: 0, zugeordnet: 0, uebersprungen: 2, jahre: 0, protokoll: 0 });
  });

  it("legt ein gelöschtes Fahrzeug mit gleichem Code neu an und ordnet seine Fahrten wieder zu", async () => {
    await t.http().delete(`/api/vehicles/${user.vehicle.id}`).set(user);   // Fahrten bleiben ohne Fahrzeug

    const res = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.equal(res.status, 201);
    assert.equal(res.body.neu, true);
    assert.equal(res.body.vehicle.code, datei.fahrzeug.code);
    assert.equal(res.body.vehicle.drive_type, "hybrid");
    assert.deepEqual(res.body.importiert, { fahrten: 0, zugeordnet: 2, uebersprungen: 0, jahre: 1, protokoll: 0 });

    const jahr = await t.http().get(`/api/fahrten?year=2026&vehicle=${res.body.vehicle.code}`).set(user);
    assert.deepEqual(jahr.body.fahrten.map(f => f.ziel), ["Kunde", "Büro"]);
    const buero = jahr.body.fahrten.find(f => f.ziel === "Büro");
    const verlauf = await t.http().get(`/api/fahrt/${buero._id}/history`).set(user);
    assert.deepEqual(verlauf.body.map(e => [e.action, e.source]), [["create", "web"], ["update", "web"]]);
    assert.equal(verlauf.body[1].new_data.vehicle_id, res.body.vehicle.id);
  });

  it("stellt nach komplettem Verlust alles mit unverändertem Protokoll wieder her", async () => {
    const vehicle = (await t.http().get("/api/vehicles").set(user)).body.find(v => v.code === datei.fahrzeug.code);
    await t.http().delete(`/api/vehicles/${vehicle.id}`).set(user);
    await t.pool.query(`DELETE FROM fahrten WHERE vehicle_id IS NULL`);
    await t.pool.query(`DELETE FROM fahrten_audit`);

    const res = await t.http().post("/api/vehicles/import").set(user).send(datei);
    assert.deepEqual(res.body.importiert, { fahrten: 2, zugeordnet: 0, uebersprungen: 0, jahre: 1, protokoll: 5 });

    // gelöschte Fahrt bleibt im Jahresprotokoll sichtbar, Quellen unverändert
    const audit = await t.http().get(`/api/audit?year=2026&vehicle=${res.body.vehicle.code}`).set(user);
    assert.deepEqual(audit.body.map(e => [e.action, e.source]), [["delete", "web"], ["update", "web"]]);
  });

  it("lehnt ungültige Dateien ab", async () => {
    assert.equal((await t.http().post("/api/vehicles/import").set(user).send({ foo: 1 })).status, 400);
    assert.equal((await t.http().post("/api/vehicles/import").set(user).send({ ...datei, version: 2 })).status, 400);
    assert.equal((await t.http().post("/api/vehicles/import").set(user)
      .send({ ...datei, fahrten: [{ id: 1, kmstand: -1, ziel: "x", fahrtart: "privat", timestamp: "2026-01-01" }] })).status, 400);
    const fremd = await t.registerUser("sicherung-fremd");
    assert.equal((await t.http().get(`/api/vehicles/${fremd.vehicle.id}/export`).set(user)).status, 404);
  });
});

describe("Gesamtsicherung", () => {
  let t, user, sicherung, zweitCode;

  before(async () => {
    t = await setup();
    user = await t.registerUser("gesamt");
    await testdaten(t, user);
    const zweit = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    zweitCode = zweit.code;
    await t.http().post("/api/fahrt").set(user).send({ kmstand: 5, ziel: "Zweit", fahrtart: "privat", timestamp: "2026-01-04T08:00:00Z", vehicle_code: zweit.code });
    await t.http().post("/api/fahrt").set(user).send({ kmstand: 7, ziel: "Ohne", fahrtart: "privat", timestamp: "2026-01-05T08:00:00Z", vehicle_code: null });
  });
  after(() => t.close());

  it("erinnert an eine Sicherung, wenn sie älter als 30 Tage ist und es Änderungen gibt", async () => {
    await t.pool.query(`UPDATE vehicles SET created_at = NOW() - INTERVAL '40 days'`);
    const vorher = await t.http().get("/api/backup/status").set(user);
    assert.equal(vorher.body.erinnern, true);
    assert.equal(vorher.body.fahrzeuge[0].last_backup_at, null);
    assert.ok(vorher.body.fahrzeuge[0].aenderungen > 0);
  });

  it("sichert alle Fahrzeuge und Fahrten ohne Fahrzeug", async () => {
    const res = await t.http().get("/api/backup").set(user);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /fahrtenbuch_sicherung_\d{4}-\d{2}-\d{2}\.json/);
    sicherung = res.body;
    assert.equal(sicherung.format, "drivingbook-sicherung");
    assert.deepEqual(sicherung.fahrzeuge.map(f => f.fahrten.length), [2, 1]);
    assert.deepEqual(sicherung.ohne_fahrzeug.fahrten.map(f => f.ziel), ["Ohne"]);

    const status = await t.http().get("/api/backup/status").set(user);
    assert.equal(status.body.erinnern, false);
    assert.ok(status.body.fahrzeuge.every(f => f.last_backup_at && f.aenderungen === 0));
  });

  it("stellt nach Datenverlust alles wieder her, ohne Doppelte", async () => {
    await t.pool.query(`DELETE FROM vehicles WHERE code = $1`, [zweitCode]);
    await t.pool.query(`DELETE FROM fahrten WHERE user_id = (SELECT id FROM users WHERE username = 'gesamt') AND ziel IN ('Zweit', 'Ohne')`);

    const res = await t.http().post("/api/backup/restore").set(user).send(sicherung);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.fahrzeuge.map(f => [f.name, f.neu, f.fahrten, f.uebersprungen]),
      [["Fahrzeug 1", false, 0, 2], ["Zweitwagen", true, 1, 0]]);
    assert.equal(res.body.ohne_fahrzeug.fahrten, 1);

    const vehicles = (await t.http().get("/api/vehicles").set(user)).body;
    assert.ok(vehicles.some(v => v.code === zweitCode));

    const nochmal = await t.http().post("/api/backup/restore").set(user).send(sicherung);
    assert.ok(nochmal.body.fahrzeuge.every(f => f.fahrten === 0 && f.protokoll === 0));
    assert.equal(nochmal.body.ohne_fahrzeug.fahrten, 0);
  });

  it("lehnt eine Fahrzeug-Sicherung am Gesamt-Endpunkt ab", async () => {
    const res = await t.http().post("/api/backup/restore").set(user).send({ format: "drivingbook-fahrzeug", version: 1 });
    assert.equal(res.status, 400);
  });

  it("akzeptiert große Sicherungen, andere Endpunkte bleiben begrenzt", async () => {
    const viele = Array.from({ length: 3000 }, (_, i) => ({
      id: i + 1, kmstand: 10000 + i, ziel: "Langer Zielname ".repeat(5), fahrtart: "privat",
      timestamp: new Date(Date.UTC(2020, 0, 1) + i * 3600e3).toISOString(),
    }));
    const gross = { ...sicherung, fahrzeuge: [{ ...sicherung.fahrzeuge[0], fahrten: viele, protokoll: [] }] };
    const res = await t.http().post("/api/backup/restore").set(user).send(gross);
    assert.equal(res.status, 200);
    assert.equal(res.body.fahrzeuge[0].fahrten, 3000);

    // Sequenz steht hinter den wiederverwendeten IDs → neue Fahrten funktionieren
    const neu = await t.http().post("/api/fahrt").set(user)
      .send({ kmstand: 99999, ziel: "Danach", fahrtart: "privat", timestamp: "2030-01-01T08:00:00Z", force: true });
    assert.equal(neu.status, 200);

    const zuGross = await t.http().post("/api/fahrt").set(user).send({ ziel: "x".repeat(200_000) });
    assert.equal(zuGross.status, 413);
  });
});
