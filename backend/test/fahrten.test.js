import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

const fahrt = (kmstand, timestamp, extra = {}) =>
  ({ kmstand, ziel: `Ziel ${kmstand}`, fahrtart: "privat", timestamp, ...extra });

describe("Fahrten", () => {
  let t, user, other;
  const post = body => t.http().post("/api/fahrt").set(user).send(body);
  const month = m => t.http().get(`/api/export/json?month=${m}`).set(user);

  before(async () => {
    t = await setup();
    user  = await t.registerUser("fahrer");
    other = await t.registerUser("fremd");
  });
  after(() => t.close());

  it("validiert neue Fahrten", async () => {
    const cases = [
      [fahrt("abc", "2026-01-01T08:00:00Z"), /kmstand/],
      [fahrt(-5, "2026-01-01T08:00:00Z"), /kmstand/],
      [fahrt(100, "2026-01-01T08:00:00Z", { ziel: "  " }), /ziel/],
      [fahrt(100, "2026-01-01T08:00:00Z", { fahrtart: "dienstlich" }), /fahrtart/],
      [fahrt(100, "gestern"), /Timestamp/],
    ];
    for (const [body, msg] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(res.body.error, msg);
    }
  });

  it("akzeptiert kmstand als String (Formular) und fremde Fahrzeuge nicht", async () => {
    const ok = await post(fahrt("1000", "2026-01-05T08:00:00Z"));
    assert.equal(ok.status, 200);

    const foreign = await post(fahrt(1100, "2026-01-06T08:00:00Z", { vehicle_code: other.vehicle.code }));
    assert.equal(foreign.status, 404);
  });

  it("bearbeitet per ID die richtige Fahrt, auch wenn sich die Reihenfolge ändert", async () => {
    const b = (await post(fahrt(1200, "2026-01-10T08:00:00Z"))).body.id;
    // nachträglich eine frühere Fahrt einfügen → Positionen verschieben sich
    await post(fahrt(900, "2026-01-02T08:00:00Z"));

    const res = await t.http().put(`/api/fahrt/${b}`).set(user).send({ ziel: "Geändert" });
    assert.equal(res.status, 200);

    const list = (await month("2026-01")).body;
    assert.equal(list.find(f => f._id === b).ziel, "Geändert");
    assert.equal(list.filter(f => f.ziel === "Geändert").length, 1);
  });

  it("erlaubt Teil-Updates mit kmstand 0 und vehicle_id null (mit force)", async () => {
    // Liegt vor allen anderen Fahrten, damit km-Stand 0 die Plausibilität späterer Tests nicht stört
    // (force nötig, da frühere Fahrten ohne vehicle_code jetzt ebenfalls das Default-Fahrzeug nutzen)
    const id = (await post(fahrt(5000, "2020-02-01T08:00:00Z", { vehicle_code: user.vehicle.code, force: true }))).body.id;
    const res = await t.http().put(`/api/fahrt/${id}`).set(user).send({ kmstand: 0, vehicle_code: null, force: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.fahrt.kmstand, 0);
    assert.equal(res.body.fahrt.vehicle_id, null);
  });

  it("lehnt leere Updates, ungültige IDs und fremde Fahrten ab", async () => {
    const id = (await post(fahrt(1300, "2026-01-15T08:00:00Z"))).body.id;
    assert.equal((await t.http().put(`/api/fahrt/${id}`).set(user).send({})).status, 400);
    assert.equal((await t.http().put("/api/fahrt/abc").set(user).send({ ziel: "x" })).status, 400);
    assert.equal((await t.http().put(`/api/fahrt/${id}`).set(other).send({ ziel: "x" })).status, 404);
    assert.equal((await t.http().delete(`/api/fahrt/${id}`).set(other)).status, 404);
  });

  it("hat die alten Index-Routen nicht mehr", async () => {
    const res = await t.http().put("/api/fahrt/2026-01/0").set(user).send({ ziel: "x" });
    assert.equal(res.status, 404);
  });

  it("ordnet Monate nach deutscher Zeit zu", async () => {
    // 31.03. 22:30 UTC = 01.04. 00:30 Sommerzeit
    const id = (await post(fahrt(20000, "2026-03-31T22:30:00Z", { vehicle_code: user.vehicle.code }))).body.id;
    const april = (await month("2026-04")).body;
    assert.ok(april.some(f => f._id === id));

    // Verschieben per PUT: neuer Monat steht in der Antwort
    const moved = await t.http().put(`/api/fahrt/${id}`).set(user).send({ timestamp: "2026-05-10T10:00:00Z" });
    assert.equal(moved.body.fahrt.month, "2026-05");
  });

  it("löscht per ID", async () => {
    const id = (await post(fahrt(1400, "2026-01-20T08:00:00Z"))).body.id;
    assert.equal((await t.http().delete(`/api/fahrt/${id}`).set(user)).status, 200);
    assert.ok(!(await month("2026-01")).body.some(f => f._id === id));
  });
});

describe("km-Plausibilität", () => {
  let t, user, vcode;
  const post = body => t.http().post("/api/fahrt").set(user).send({ vehicle_code: vcode, ...body });

  before(async () => {
    t = await setup();
    user = await t.registerUser("plausi");
    vcode = user.vehicle.code;
    await post(fahrt(1000, "2026-06-01T08:00:00Z"));
    await post(fahrt(2000, "2026-06-10T08:00:00Z"));
  });
  after(() => t.close());

  it("lehnt kleinere km-Stände als bei der vorherigen Fahrt ab", async () => {
    const res = await post(fahrt(900, "2026-06-05T08:00:00Z"));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "KM_PLAUSIBILITY");
  });

  it("lehnt größere km-Stände als bei der folgenden Fahrt ab", async () => {
    const res = await post(fahrt(2500, "2026-06-05T08:00:00Z"));
    assert.equal(res.status, 409);
  });

  it("akzeptiert passende Werte und force", async () => {
    assert.equal((await post(fahrt(1500, "2026-06-05T08:00:00Z"))).status, 200);
    assert.equal((await post({ ...fahrt(10, "2026-06-06T08:00:00Z"), force: true })).status, 200);
  });

  it("prüft je Fahrzeug getrennt", async () => {
    const zweites = await t.http().post("/api/vehicles").set(user).send({ name: "Zweitwagen" });
    const res = await t.http().post("/api/fahrt").set(user)
      .send({ ...fahrt(50, "2026-06-07T08:00:00Z"), vehicle_code: zweites.body.code });
    assert.equal(res.status, 200);
  });
});

describe("Änderungsprotokoll", () => {
  let t, user, id;

  before(async () => {
    t = await setup();
    user = await t.registerUser("audit");
    id = (await t.http().post("/api/fahrt").set(user).send(fahrt(100, "2026-07-01T08:00:00Z"))).body.id;
    await t.http().put(`/api/fahrt/${id}`).set(user).send({ ziel: "Neu" });
  });
  after(() => t.close());

  it("protokolliert Anlage und Änderung mit altem und neuem Wert", async () => {
    const res = await t.http().get(`/api/fahrt/${id}/history`).set(user);
    assert.deepEqual(res.body.map(e => e.action), ["create", "update"]);
    assert.equal(res.body[1].old_data.ziel, "Ziel 100");
    assert.equal(res.body[1].new_data.ziel, "Neu");
    assert.equal(res.body[1].source, "web");
  });

  it("markiert geänderte Fahrten im Export", async () => {
    const list = (await t.http().get("/api/export/json?month=2026-07").set(user)).body;
    assert.equal(list[0].edited, true);
  });

  it("behält Löschungen im Jahresprotokoll und merkt sich die Quelle", async () => {
    await t.http().delete(`/api/fahrt/${id}`).set("X-API-Token", user.apiToken).expect(200);
    const res = await t.http().get("/api/audit?year=2026").set(user);
    assert.deepEqual(res.body.map(e => e.action), ["delete", "update"]);
    assert.equal(res.body[0].old_data.ziel, "Neu");
    assert.equal(res.body[0].source, "api_token");
  });

  it("zeigt fremde Protokolle nicht", async () => {
    const other = await t.registerUser("neugierig");
    assert.equal((await t.http().get(`/api/fahrt/${id}/history`).set(other)).status, 404);
    assert.deepEqual((await t.http().get("/api/audit?year=2026").set(other)).body, []);
  });
});
