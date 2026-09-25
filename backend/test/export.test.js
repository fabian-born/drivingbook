import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

// supertest liefert Binärdaten nur mit eigenem Parser als Buffer
const binary = (res, callback) => {
  const chunks = [];
  res.on("data", c => chunks.push(c));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};

describe("Export", () => {
  let t, user;
  const post = body => t.http().post("/api/fahrt").set(user).send(body);

  before(async () => {
    t = await setup();
    user = await t.registerUser("export");
    await post({ kmstand: 100, ziel: "Start", fahrtart: "privat", timestamp: "2025-12-20T08:00:00Z" });
    await post({ kmstand: 150, ziel: '=HYPERLINK("http://x") "Zitat"', fahrtart: "geschäftlich", timestamp: "2026-01-10T08:00:00Z" });
    const id = (await post({ kmstand: 200, ziel: "Kunde", fahrtart: "privat", timestamp: "2026-02-10T08:00:00Z" })).body.id;
    await t.http().put(`/api/fahrt/${id}`).set(user).send({ ziel: "Kunde GmbH" });
  });
  after(() => t.close());

  it("liefert 404 für Monate ohne Fahrten", async () => {
    assert.equal((await t.http().get("/api/export/json?month=2026-08").set(user)).status, 404);
    assert.equal((await t.http().get("/api/export/json?month=2026-13").set(user)).status, 400);
  });

  it("maskiert CSV-Felder und verhindert Formel-Injection", async () => {
    const res = await t.http().get("/api/export/csv/year/2026").set(user);
    assert.equal(res.status, 200);
    const lines = res.text.replace(/^﻿/, "").trim().split("\n");
    assert.equal(lines.length, 3);  // Kopf + 2 Fahrten aus 2026
    assert.ok(lines[1].includes(`"'=HYPERLINK(""http://x"") ""Zitat"""`));
    assert.ok(lines[1].includes("10.01.2026 09:00"));  // deutsche Zeit
    assert.ok(lines[2].endsWith(";ja"));               // nachträglich geändert
  });

  it("erzeugt ein PDF für ein Jahr", async () => {
    const res = await t.http().get("/api/export/pdf/year/2026").set(user).buffer(true).parse(binary);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(res.body.subarray(0, 5).toString(), "%PDF-");
    assert.ok(res.body.length > 1000);
  });

  it("erzeugt auch für leere Jahre ein PDF", async () => {
    const res = await t.http().get("/api/export/pdf/year/2030").set(user).buffer(true).parse(binary);
    assert.equal(res.status, 200);
    assert.equal(res.body.subarray(0, 5).toString(), "%PDF-");
  });

  it("schränkt Exporte auf ein Fahrzeug ein", async () => {
    const zweites = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    await post({ kmstand: 10, ziel: "Zweitwagen", fahrtart: "privat", timestamp: "2026-01-15T08:00:00Z", vehicle_code: zweites.code });

    const alle  = await t.http().get("/api/export/json?month=2026-01").set(user);
    const nur2  = await t.http().get(`/api/export/json?month=2026-01&vehicle=${zweites.code.toLowerCase()}`).set(user);
    const nur1  = await t.http().get(`/api/export/json?month=2026-01&vehicle=${user.vehicle.code}`).set(user);
    assert.equal(alle.body.length, 2);
    assert.deepEqual(nur2.body.map(f => f.ziel), ["Zweitwagen"]);
    assert.equal(nur1.body.length, 1);
    assert.notEqual(nur1.body[0].ziel, "Zweitwagen");

    const csv = await t.http().get(`/api/export/csv/year/2026?vehicle=${zweites.code}`).set(user);
    assert.equal(csv.text.replace(/^\uFEFF/, "").trim().split("\n").length, 2);  // Kopf + 1 Fahrt

    const pdf = await t.http().get(`/api/export/pdf/year/2026?vehicle=${zweites.code}`).set(user).buffer(true).parse(binary);
    assert.equal(pdf.status, 200);

    const leer = await t.http().get(`/api/export/json?month=2026-02&vehicle=${zweites.code}`).set(user);
    assert.equal(leer.status, 404);
  });

  it("lehnt fremde und ungültige Fahrzeug-Codes ab", async () => {
    const fremd = await t.registerUser("export-fremd");
    assert.equal((await t.http().get(`/api/export/json?month=2026-01&vehicle=${fremd.vehicle.code}`).set(user)).status, 404);
    assert.equal((await t.http().get("/api/export/json?month=2026-01&vehicle=xx").set(user)).status, 400);
    assert.equal((await t.http().get(`/api/audit?year=2026&vehicle=${fremd.vehicle.code}`).set(user)).status, 404);
  });

  it("verlangt Anmeldung", async () => {
    assert.equal((await t.http().get("/api/export/pdf/year/2026")).status, 401);
  });
});

describe("Jahresfahrten", () => {
  let t, user;
  const post = body => t.http().post("/api/fahrt").set(user).send({ ziel: "Ziel", fahrtart: "privat", ...body });

  before(async () => {
    t = await setup();
    user = await t.registerUser("jahr");
    await post({ kmstand: 900,  timestamp: "2025-11-01T08:00:00Z" });
    await post({ kmstand: 1000, timestamp: "2025-12-31T20:00:00Z" });
    await post({ kmstand: 1100, timestamp: "2026-01-02T08:00:00Z", fahrtart: "geschäftlich" });
    await post({ kmstand: 1150, timestamp: "2026-01-20T08:00:00Z" });
    await post({ kmstand: 1400, timestamp: "2026-03-05T08:00:00Z", fahrtart: "geschäftlich" });
    const zweit = (await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" })).body;
    await post({ kmstand: 50, timestamp: "2026-01-10T08:00:00Z", vehicle_code: zweit.code });
  });
  after(() => t.close());

  it("liefert Strecken, Monate und Summe über den Jahreswechsel hinweg", async () => {
    const res = await t.http().get(`/api/fahrten?year=2026&vehicle=${user.vehicle.code}`).set(user);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.fahrten.map(f => f.strecke), [100, 50, 250]);
    assert.deepEqual(res.body.monate, [
      { monat: "2026-01", start_km: 1000, end_km: 1150, fahrten: 2, gesamt: 150, privat: 50, geschaeftlich: 100, arbeitsweg: 0 },
      { monat: "2026-03", start_km: 1150, end_km: 1400, fahrten: 1, gesamt: 250, privat: 0, geschaeftlich: 250, arbeitsweg: 0 },
    ]);
    assert.deepEqual(res.body.summe, { fahrten: 3, gesamt: 400, privat: 50, geschaeftlich: 350, arbeitsweg: 0 });
    assert.ok(res.body.fahrten[0]._id);
  });

  it("rechnet ohne Fahrzeugfilter je Fahrzeug getrennt", async () => {
    const res = await t.http().get("/api/fahrten?year=2026").set(user);
    assert.equal(res.body.fahrten.length, 4);
    assert.equal(res.body.fahrten.find(f => f.kmstand === 50).strecke, null);  // erste Fahrt des Zweitwagens
    assert.equal(res.body.summe.gesamt, 400);
  });

  it("validiert das Jahr", async () => {
    assert.equal((await t.http().get("/api/fahrten").set(user)).status, 400);
    assert.deepEqual((await t.http().get("/api/fahrten?year=2030").set(user)).body.fahrten, []);
  });
});
