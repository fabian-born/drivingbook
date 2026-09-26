import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { steuerVergleich } from "../src/lib/steuer.js";

const kosten = { total_costs: 9000, depreciation: 4000, commute_km: 20, months: 12, tax_rate: 42 };
const km     = { private: 3000, total: 20000 };

describe("Steuervergleich", () => {
  it("rechnet die 1-%-Regel mit Arbeitsweg und das Fahrtenbuch für Verbrenner", () => {
    const v = steuerVergleich({ list_price: 45990, drive_type: "combustion" }, kosten, km);
    assert.equal(v.list_price, 45900);                 // auf volle 100 € abgerundet
    assert.equal(v.flat_rate.private_use, 5508);       // 45.900 × 1 % × 12
    assert.equal(v.flat_rate.commute, 3304.8);        // 45.900 × 0,03 % × 20 km × 12
    assert.equal(v.flat_rate.total, 8812.8);
    assert.equal(v.flat_rate.capped, false);
    assert.equal(v.logbook.total, 1350);            // 9.000 × 15 %
    assert.equal(v.difference, 7462.8);
    assert.equal(v.recommendation, "logbook");
    assert.equal(v.tax_savings, 3134.38);
    assert.ok(Math.abs(v.break_even_share - 0.9792) < 0.0001);
  });

  it("setzt bei E-Autos Satz und AfA auf ein Viertel", () => {
    const v = steuerVergleich({ list_price: 45990, drive_type: "electric" }, kosten, km);
    assert.equal(v.total_costs, 6000);                // 5.000 + 4.000 / 4
    assert.equal(v.flat_rate.private_use, 1377);
    assert.equal(v.flat_rate.commute, 826.2);
    assert.equal(v.logbook.total, 900);
  });

  it("deckelt die Pauschale auf die tatsächlichen Kosten", () => {
    const v = steuerVergleich({ list_price: 45990, drive_type: "combustion" },
      { ...kosten, total_costs: 3000, depreciation: 0 }, km);
    assert.equal(v.flat_rate.total, 3000);
    assert.equal(v.flat_rate.capped, true);
  });

  it("empfiehlt die Pauschale bei hohem Privatanteil", () => {
    const v = steuerVergleich({ list_price: 20000, drive_type: "combustion" },
      { ...kosten, commute_km: 0 }, { private: 18000, total: 20000 });
    assert.equal(v.recommendation, "flat_rate");
    assert.ok(v.difference < 0);
  });

  it("liefert null ohne Listenpreis oder Kosten, ohne Fahrten keinen Fahrtenbuchwert", () => {
    assert.equal(steuerVergleich({ list_price: null, drive_type: "combustion" }, kosten, km), null);
    assert.equal(steuerVergleich({ list_price: 30000, drive_type: "combustion" }, null, km), null);
    const v = steuerVergleich({ list_price: 30000, drive_type: "combustion" }, kosten, { private: 0, total: 0 });
    assert.equal(v.logbook, null);
    assert.equal(v.recommendation, null);
  });
});

describe("Steuervergleich mit Arbeitsweg", () => {
  it("zählt Fahrten zur Arbeit beim Fahrtenbuch zur privaten Nutzung", () => {
    const v = steuerVergleich({ list_price: 45990, drive_type: "combustion" }, kosten,
      { private: 3000, commute: 2000, total: 20000 });
    assert.equal(v.logbook.private_share, 0.25);
    assert.equal(v.logbook.total, 2250);
  });
});
