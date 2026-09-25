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
