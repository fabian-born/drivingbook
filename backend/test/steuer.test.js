import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { steuerVergleich } from "../src/lib/steuer.js";

const kosten = { total_costs: 9000, depreciation: 4000, commute_km: 20, months: 12, tax_rate: 42 };
const km     = { privat: 3000, gesamt: 20000 };

describe("Steuervergleich", () => {
  it("rechnet die 1-%-Regel mit Arbeitsweg und das Fahrtenbuch für Verbrenner", () => {
    const v = steuerVergleich({ list_price: 45990, drive_type: "verbrenner" }, kosten, km);
    assert.equal(v.listenpreis, 45900);                 // auf volle 100 € abgerundet
    assert.equal(v.pauschal.privatnutzung, 5508);       // 45.900 × 1 % × 12
    assert.equal(v.pauschal.arbeitsweg, 3304.8);        // 45.900 × 0,03 % × 20 km × 12
    assert.equal(v.pauschal.summe, 8812.8);
    assert.equal(v.pauschal.gedeckelt, false);
    assert.equal(v.fahrtenbuch.summe, 1350);            // 9.000 × 15 %
    assert.equal(v.differenz, 7462.8);
    assert.equal(v.empfehlung, "fahrtenbuch");
    assert.equal(v.steuer_ersparnis, 3134.38);
    assert.ok(Math.abs(v.break_even_anteil - 0.9792) < 0.0001);
  });

  it("setzt bei E-Autos Satz und AfA auf ein Viertel", () => {
    const v = steuerVergleich({ list_price: 45990, drive_type: "elektro" }, kosten, km);
    assert.equal(v.kosten_gesamt, 6000);                // 5.000 + 4.000 / 4
    assert.equal(v.pauschal.privatnutzung, 1377);
    assert.equal(v.pauschal.arbeitsweg, 826.2);
    assert.equal(v.fahrtenbuch.summe, 900);
  });

  it("deckelt die Pauschale auf die tatsächlichen Kosten", () => {
    const v = steuerVergleich({ list_price: 45990, drive_type: "verbrenner" },
      { ...kosten, total_costs: 3000, depreciation: 0 }, km);
    assert.equal(v.pauschal.summe, 3000);
    assert.equal(v.pauschal.gedeckelt, true);
  });

  it("empfiehlt die Pauschale bei hohem Privatanteil", () => {
    const v = steuerVergleich({ list_price: 20000, drive_type: "verbrenner" },
      { ...kosten, commute_km: 0 }, { privat: 18000, gesamt: 20000 });
    assert.equal(v.empfehlung, "pauschal");
    assert.ok(v.differenz < 0);
  });

  it("liefert null ohne Listenpreis oder Kosten, ohne Fahrten keinen Fahrtenbuchwert", () => {
    assert.equal(steuerVergleich({ list_price: null, drive_type: "verbrenner" }, kosten, km), null);
    assert.equal(steuerVergleich({ list_price: 30000, drive_type: "verbrenner" }, null, km), null);
    const v = steuerVergleich({ list_price: 30000, drive_type: "verbrenner" }, kosten, { privat: 0, gesamt: 0 });
    assert.equal(v.fahrtenbuch, null);
    assert.equal(v.empfehlung, null);
  });
});
