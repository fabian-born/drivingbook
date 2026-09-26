import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { languageFrom, translate } from "../src/i18n.js";
import { setup } from "./helpers.js";

const header = value => ({ get: name => (name === "accept-language" ? value : undefined) });

describe("Language selection", () => {
  it("picks the first supported language by q value, German by default", () => {
    assert.equal(languageFrom(header(undefined)), "de");
    assert.equal(languageFrom(header("en-GB,en;q=0.9")), "en");
    assert.equal(languageFrom(header("fr-FR, en;q=0.5, de;q=0.8")), "de");
    assert.equal(languageFrom(header("fr, it")), "de");
  });

  it("translates with plurals and falls back to the key for literal texts", () => {
    assert.equal(translate("en", "check.edited", { count: 1 }), "1 trip was changed afterwards – traceable in the audit log.");
    assert.equal(translate("de", "check.edited", { count: 2 }), "2 Fahrten wurden nachträglich geändert – nachvollziehbar im Änderungsprotokoll.");
    assert.equal(translate("en", "Freitext ohne Schlüssel"), "Freitext ohne Schlüssel");
  });
});

describe("Translated API responses", () => {
  let t, user;
  const en = { "Accept-Language": "en-GB,en;q=0.9" };
  const post = (body, headers = {}) => t.http().post("/api/trips").set(user).set(headers)
    .send({ destination: "Kunde", trip_type: "private", ...body });

  before(async () => {
    t = await setup();
    user = await t.registerUser("sprache");
  });
  after(() => t.close());

  it("answers errors in English, in German without header", async () => {
    const de = await post({ odometer_km: -1, timestamp: "2026-01-01T08:00:00Z" });
    assert.equal(de.body.error, "km-Stand muss eine ganze Zahl ≥ 0 sein");
    const res = await post({ odometer_km: -1, timestamp: "2026-01-01T08:00:00Z" }, en);
    assert.equal(res.body.error, "Odometer reading must be a whole number ≥ 0");
    assert.equal((await t.http().get("/api/nope").set(en)).body.error, "Endpoint not found");
  });

  it("fills placeholders from the validation (limits, allowed values)", async () => {
    const lang = await post({ odometer_km: 5, timestamp: "2026-01-01T08:00:00Z", destination: "x".repeat(501) }, en);
    assert.equal(lang.body.error, "At most 500 characters allowed");
    const typ = await post({ odometer_km: 5, timestamp: "2026-01-01T08:00:00Z", trip_type: "holiday" }, en);
    assert.equal(typ.body.error, "Trip type must be one of: business, private, commute");
  });

  it("formats the km plausibility message in the requested language", async () => {
    const ok = await post({ odometer_km: 1000, timestamp: "2026-03-01T08:00:00Z" }, en);
    assert.equal(ok.body.message, "Trip saved");
    const res = await post({ odometer_km: 900, timestamp: "2026-03-02T08:00:00Z" }, en);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "KM_PLAUSIBILITY");
    assert.equal(res.body.error, "Odometer reading 900 is lower than on the previous trip (1000 km on 01/03/2026, 09:00:00)");
  });

  it("returns check findings in the requested language", async () => {
    await post({ odometer_km: 5000, timestamp: "2026-03-03T08:00:00Z", force: true });
    const res = await t.http().get(`/api/vehicles/${user.vehicle.id}/check?year=2026`).set(user).set(en);
    assert.deepEqual(res.body.findings.map(f => f.text), ["4,000 km since the previous trip – are trips missing in between?"]);
  });
});
