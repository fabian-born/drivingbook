import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

describe("Admin: Datenbank aufräumen", () => {
  let t, admin, user, other, bearbeitet;
  const post = (who, body) => t.http().post("/api/fahrt").set(who)
    .send({ ziel: "Kunde", fahrtart: "privat", force: true, ...body });
  const bericht = async () => (await t.http().get("/api/admin/aufraeumen").set(admin)).body;

  before(async () => {
    t = await setup();
    admin = await t.login();
    user  = await t.registerUser("aufraeumen");
    other = await t.registerUser("aufraeumen2");

    // Doppelklick: 3 × gleiche Fahrt innerhalb von Sekunden; die mittlere wurde bearbeitet
    await post(user, { kmstand: 100, timestamp: "2026-03-01T08:00:00.000Z" });
    bearbeitet = (await post(user, { kmstand: 100, timestamp: "2026-03-01T08:00:00.400Z" })).body.id;
    await t.http().put(`/api/fahrt/${bearbeitet}`).set(user).send({ fahrtart: "privat" });
    await post(user, { kmstand: 100, timestamp: "2026-03-01T08:00:02.000Z" });
    // kein Duplikat: anderes Ziel / zu großer Abstand / anderes Fahrzeug
    await post(user, { kmstand: 100, timestamp: "2026-03-01T08:00:03.000Z", ziel: "Anderes Ziel" });
    await post(user, { kmstand: 100, timestamp: "2026-03-01T09:00:00.000Z" });
    await post(user, { kmstand: 100, timestamp: "2026-03-01T08:00:01.000Z", vehicle_code: null });
    // Fahrten ohne Fahrzeug beim zweiten User
    await post(other, { kmstand: 10, timestamp: "2026-03-02T08:00:00Z", vehicle_code: null });
    await post(other, { kmstand: 20, timestamp: "2026-03-03T08:00:00Z", vehicle_code: null });
  });
  after(() => t.close());

  it("ist nur für Admins", async () => {
    assert.equal((await t.http().get("/api/admin/aufraeumen").set(user)).status, 403);
    assert.equal((await t.http().post("/api/admin/aufraeumen/duplikate").set(user).send({})).status, 403);
  });

  it("findet Duplikate und behält die Fahrt mit Verlauf", async () => {
    const b = await bericht();
    assert.equal(b.duplikate.gruppen.length, 1);
    const g = b.duplikate.gruppen[0];
    assert.equal(g.username, "aufraeumen");
    assert.equal(g.behalten.id, bearbeitet);
    assert.equal(g.entfernen.length, 2);
    assert.equal(b.duplikate.zu_entfernen, 2);
  });

  it("listet Fahrten ohne Fahrzeug je Benutzer mit dessen Fahrzeugen", async () => {
    const b = await bericht();
    assert.deepEqual(b.ohne_fahrzeug.map(o => [o.username, o.anzahl]), [["aufraeumen", 1], ["aufraeumen2", 2]]);
    assert.equal(b.ohne_fahrzeug[1].fahrzeuge[0].code, other.vehicle.code);
  });

  it("löscht nur ausgewählte, tatsächlich doppelte Fahrten und protokolliert das", async () => {
    const g = (await bericht()).duplikate.gruppen[0];
    const res = await t.http().post("/api/admin/aufraeumen/duplikate").set(admin)
      .send({ ids: [g.entfernen[0].id, bearbeitet] });
    assert.deepEqual(res.body, { entfernt: 1, abgelehnt: [bearbeitet] });

    const audit = await t.http().get("/api/audit?year=2026").set(user);
    assert.deepEqual(audit.body.filter(e => e.source === "admin").map(e => [e.fahrt_id, e.action]), [[g.entfernen[0].id, "delete"]]);

    const rest = await t.http().post("/api/admin/aufraeumen/duplikate").set(admin).send({});
    assert.equal(rest.body.entfernt, 1);
    assert.equal((await bericht()).duplikate.gruppen.length, 0);
  });

  it("ordnet Fahrten ohne Fahrzeug einem Fahrzeug des Benutzers zu", async () => {
    const ziel = (await bericht()).ohne_fahrzeug.find(o => o.username === "aufraeumen2");
    const fremd = await t.http().post("/api/admin/aufraeumen/ohne-fahrzeug").set(admin)
      .send({ user_id: ziel.user_id, aktion: "zuordnen", vehicle_id: user.vehicle.id });
    assert.equal(fremd.status, 400);
    assert.equal((await t.http().post("/api/admin/aufraeumen/ohne-fahrzeug").set(admin)
      .send({ user_id: ziel.user_id, aktion: "zuordnen" })).status, 400);

    const res = await t.http().post("/api/admin/aufraeumen/ohne-fahrzeug").set(admin)
      .send({ user_id: ziel.user_id, aktion: "zuordnen", vehicle_id: other.vehicle.id });
    assert.deepEqual(res.body, { anzahl: 2 });

    const jahr = await t.http().get(`/api/fahrten?year=2026&vehicle=${other.vehicle.code}`).set(other);
    assert.equal(jahr.body.fahrten.length, 2);
    const verlauf = await t.http().get(`/api/fahrt/${jahr.body.fahrten[0]._id}/history`).set(other);
    assert.deepEqual(verlauf.body.map(e => [e.action, e.source]), [["create", "web"], ["update", "admin"]]);
  });

  it("löscht Fahrten ohne Fahrzeug auf Wunsch", async () => {
    const ziel = (await bericht()).ohne_fahrzeug.find(o => o.username === "aufraeumen");
    const res = await t.http().post("/api/admin/aufraeumen/ohne-fahrzeug").set(admin)
      .send({ user_id: ziel.user_id, aktion: "loeschen" });
    assert.deepEqual(res.body, { anzahl: 1 });
    assert.deepEqual((await bericht()).ohne_fahrzeug, []);
  });
});
