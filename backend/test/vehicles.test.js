import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

describe("Auto-Info", () => {
  let t, user, other, id;
  const post = body => t.http().post("/api/fahrt").set(user).send({ fahrtart: "privat", ziel: "Ziel", ...body });

  before(async () => {
    t = await setup();
    user  = await t.registerUser("autoinfo");
    other = await t.registerUser("autoinfo-fremd");
    id = user.vehicle.id;
    await post({ kmstand: 1000, timestamp: "2025-12-30T08:00:00Z" });
    await post({ kmstand: 1100, timestamp: "2026-01-05T08:00:00Z", fahrtart: "geschäftlich" });  // 100 km, über den Jahreswechsel
    await post({ kmstand: 1150, timestamp: "2026-02-01T08:00:00Z" });                            // 50 km privat
  });
  after(() => t.close());

  it("ändert Fahrzeugdaten", async () => {
    const res = await t.http().patch(`/api/vehicles/${id}`).set(user)
      .send({ license_plate: "b-xy 42", list_price: "45990", drive_type: "elektro" });
    assert.equal(res.status, 200);
    assert.equal(res.body.license_plate, "B-XY 42");
    assert.equal(res.body.list_price, 45990);
    assert.equal(res.body.drive_type, "elektro");
    assert.equal((await t.http().patch(`/api/vehicles/${id}`).set(user).send({})).status, 400);
    assert.equal((await t.http().patch(`/api/vehicles/${id}`).set(other).send({ name: "x" })).status, 404);
  });

  it("liefert Kennzahlen je Jahr, ohne Kosten noch keinen Vergleich", async () => {
    const res = await t.http().get(`/api/vehicles/${id}/info?year=2026`).set(user);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.jahr, { fahrten: 2, privat: 50, geschaeftlich: 100, arbeitsweg: 0, gesamt: 150 });
    assert.equal(res.body.gesamt.fahrten, 3);
    assert.equal(res.body.gesamt.km_aktuell, 1150);
    assert.equal(res.body.kosten, null);
    assert.equal(res.body.vergleich, null);
  });

  it("speichert Jahreskosten und rechnet den Vergleich", async () => {
    const put = await t.http().put(`/api/vehicles/${id}/years/2026`).set(user)
      .send({ total_costs: "9000", depreciation: "4000", months: 12 });
    assert.equal(put.status, 200);
    // zweites Speichern überschreibt
    await t.http().put(`/api/vehicles/${id}/years/2026`).set(user).send({ total_costs: 9000, depreciation: 4000, tax_rate: 30 });

    const res = await t.http().get(`/api/vehicles/${id}/info?year=2026`).set(user);
    assert.equal(res.body.kosten.tax_rate, 30);
    assert.equal(res.body.vergleich.satz, 0.25);
    assert.equal(res.body.vergleich.kosten_gesamt, 6000);
    assert.equal(res.body.vergleich.fahrtenbuch.summe, 2000);   // 6.000 × 50/150
    assert.equal(res.body.vergleich.pauschal.summe, 1377);
    assert.equal(res.body.vergleich.empfehlung, "pauschal");
  });

  it("validiert und schützt fremde Fahrzeuge", async () => {
    assert.equal((await t.http().put(`/api/vehicles/${id}/years/2026`).set(user).send({ total_costs: "" })).status, 400);
    assert.equal((await t.http().put(`/api/vehicles/${id}/years/2026`).set(user).send({ total_costs: 1, months: 13 })).status, 400);
    assert.equal((await t.http().put(`/api/vehicles/${id}/years/2026`).set(other).send({ total_costs: 1 })).status, 404);
    assert.equal((await t.http().get(`/api/vehicles/${id}/info`).set(other)).status, 404);
  });

  it("zeigt die neuen Felder in der Fahrzeugliste", async () => {
    const list = (await t.http().get("/api/vehicles").set(user)).body;
    assert.equal(list[0].drive_type, "elektro");
    assert.equal(list[0].list_price, 45990);
  });

  it("löscht ein Fahrzeug mit Fahrten nur mit Zielfahrzeug und protokolliert den Umzug", async () => {
    const zweit = (await t.http().post("/api/vehicles").set(user).send({ name: "Neuwagen" })).body;
    const ohneZiel = await t.http().delete(`/api/vehicles/${id}`).set(user);
    assert.equal(ohneZiel.status, 409);
    assert.equal(ohneZiel.body.code, "HAT_FAHRTEN");
    assert.equal(ohneZiel.body.anzahl, 3);
    assert.equal((await t.http().delete(`/api/vehicles/${id}?ziel=${id}`).set(user)).status, 400);
    assert.equal((await t.http().delete(`/api/vehicles/${id}?ziel=${other.vehicle.id}`).set(user)).status, 400);

    const res = await t.http().delete(`/api/vehicles/${id}?ziel=${zweit.id}`).set(user);
    assert.deepEqual(res.body, { message: "Fahrzeug gelöscht", verschoben: 3 });
    const jahr = await t.http().get(`/api/fahrten?year=2026&vehicle=${zweit.code}`).set(user);
    assert.equal(jahr.body.fahrten.length, 2);
    const verlauf = await t.http().get(`/api/fahrt/${jahr.body.fahrten[0]._id}/history`).set(user);
    assert.equal(verlauf.body.at(-1).new_data.vehicle_id, zweit.id);

    // Fahrzeug ohne Fahrten lässt sich direkt löschen
    const leer = (await t.http().post("/api/vehicles").set(user).send({ name: "Leer" })).body;
    assert.equal((await t.http().delete(`/api/vehicles/${leer.id}`).set(user)).status, 200);
  });
});
