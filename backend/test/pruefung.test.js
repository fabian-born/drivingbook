import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pruefeJahr } from "../src/lib/pruefung.js";
import { setup } from "./helpers.js";

const f = (id, kmstand, strecke, timestamp, vorher_timestamp, ziel = "Kunde") =>
  ({ id, kmstand, strecke, timestamp, vorher_timestamp, ziel });

describe("Prüfregeln", () => {
  const jetzt = new Date("2026-12-31T00:00:00Z");

  it("ist grün ohne Auffälligkeiten", () => {
    const r = pruefeJahr([
      f(1, 1000, null, "2026-01-01T08:00:00Z", null),
      f(2, 1050, 50,   "2026-01-02T08:00:00Z", "2026-01-01T08:00:00Z"),
    ], { jetzt });
    assert.deepEqual(r, { ampel: "gruen", befunde: [] });
  });

  it("findet Rückschritte, Lücken, große Strecken, Koordinaten und Zukunft", () => {
    const r = pruefeJahr([
      f(1, 1000, 20,   "2026-01-01T08:00:00Z", "2025-12-30T08:00:00Z"),
      f(2, 900,  -100, "2026-01-02T08:00:00Z", "2026-01-01T08:00:00Z"),
      f(3, 1500, 600,  "2026-03-15T08:00:00Z", "2026-01-02T08:00:00Z"),       // 72 Tage, 600 km
      f(4, 2700, 1200, "2026-03-16T08:00:00Z", "2026-03-15T08:00:00Z"),
      f(5, 2710, 10,   "2026-03-17T08:00:00Z", "2026-03-16T08:00:00Z", "52.520008, 13.404954"),
      f(6, 2720, 10,   "2027-02-01T08:00:00Z", "2026-03-17T08:00:00Z"),
    ], { jetzt, geaendert: 2, geloescht: 1, ohneFahrzeug: 3 });

    assert.equal(r.ampel, "rot");
    assert.deepEqual(r.befunde.map(b => [b.typ, b.fahrt_id]), [
      ["rueckschritt", 2], ["luecke", 3], ["grosse_strecke", 4], ["koordinaten", 5], ["zukunft", 6],
      ["ohne_fahrzeug", undefined], ["geaendert", undefined], ["geloescht", undefined],
    ]);
  });

  it("ist gelb bei Warnungen und meldet leere Jahre", () => {
    assert.equal(pruefeJahr([], { ohneFahrzeug: 1 }).ampel, "gelb");
    assert.equal(pruefeJahr([]).befunde[0].typ, "leer");
  });
});

describe("Prüfung per API", () => {
  let t, user;
  before(async () => {
    t = await setup();
    user = await t.registerUser("pruefer");
    const post = body => t.http().post("/api/fahrt").set(user).send({ fahrtart: "privat", ziel: "Kunde", ...body });
    await post({ kmstand: 1000, timestamp: "2026-01-01T08:00:00Z" });
    const id = (await post({ kmstand: 3000, timestamp: "2026-01-05T08:00:00Z" })).body.id;
    await t.http().put(`/api/fahrt/${id}`).set(user).send({ ziel: "Neu" });
    await post({ kmstand: 3010, timestamp: "2026-01-06T08:00:00Z", vehicle_code: null });
  });
  after(() => t.close());

  it("liefert Ampel und Befunde für ein Fahrzeug", async () => {
    const res = await t.http().get(`/api/vehicles/${user.vehicle.id}/pruefung?year=2026`).set(user);
    assert.equal(res.status, 200);
    assert.equal(res.body.ampel, "gelb");
    assert.deepEqual(res.body.befunde.map(b => b.typ), ["grosse_strecke", "ohne_fahrzeug", "geaendert"]);
  });

  it("schützt fremde Fahrzeuge", async () => {
    const other = await t.registerUser("pruefer-fremd");
    assert.equal((await t.http().get(`/api/vehicles/${user.vehicle.id}/pruefung`).set(other)).status, 404);
  });
});
