// ============================================================
// Vergleich 1-%-Regel ↔ Fahrtenbuch (vereinfachte Schätzung,
// keine Steuerberatung)
//
// Pauschal:     Listenpreis (auf volle 100 € abgerundet) × Satz × Monate
//               + 0,03 % × Listenpreis × Entfernung Wohnung–Arbeit × Monate
//               (Satz bei E-/Hybridfahrzeugen anteilig), höchstens die Kosten
//               (Kostendeckelung)
// Fahrtenbuch:  Kosten × Anteil privater Kilometer
//               (AfA/Leasing bei E-/Hybridfahrzeugen anteilig wie der Satz)
// ============================================================

// Monatlicher Pauschalsatz in Prozent des Listenpreises
export const PAUSCHALSATZ = {
  verbrenner:    1,
  hybrid:        0.5,
  elektro:       0.25,
  elektro_teuer: 0.5,
};

const runde = betrag => Math.round(betrag * 100) / 100;

// vehicle: { list_price, drive_type }
// kosten:  { total_costs, depreciation, commute_km, months, tax_rate } oder null
// km:      { privat, gesamt }
// Liefert null, solange Listenpreis oder Kosten fehlen.
export function steuerVergleich(vehicle, kosten, km) {
  if (vehicle.list_price == null || !kosten) return null;

  const satz   = PAUSCHALSATZ[vehicle.drive_type] ?? 1;
  const faktor = satz / 1;   // Anteil gegenüber dem vollen 1-%-Satz
  const listenpreis = Math.floor(vehicle.list_price / 100) * 100;

  // AfA/Leasing zählt bei E-/Hybridfahrzeugen nur anteilig
  const kostenGesamt = kosten.total_costs - kosten.depreciation + kosten.depreciation * faktor;

  const privatnutzung = listenpreis * satz / 100 * kosten.months;
  const arbeitsweg    = listenpreis * 0.03 / 100 * faktor * kosten.commute_km * kosten.months;
  const pauschalOhneDeckel = privatnutzung + arbeitsweg;
  const pauschal = Math.min(pauschalOhneDeckel, kostenGesamt);

  const privatAnteil = km.gesamt > 0 ? km.privat / km.gesamt : null;
  const fahrtenbuch  = privatAnteil == null ? null : kostenGesamt * privatAnteil;

  // Bis zu diesem Privatanteil ist das Fahrtenbuch günstiger
  const breakEven = kostenGesamt > 0 ? Math.min(pauschal / kostenGesamt, 1) : null;

  const differenz = fahrtenbuch == null ? null : pauschal - fahrtenbuch;  // > 0 → Fahrtenbuch günstiger
  const ersparnis = differenz == null || kosten.tax_rate == null
    ? null
    : Math.abs(differenz) * kosten.tax_rate / 100;

  return {
    satz,
    listenpreis,
    kosten_gesamt:       runde(kostenGesamt),
    pauschal: {
      privatnutzung:     runde(privatnutzung),
      arbeitsweg:        runde(arbeitsweg),
      gedeckelt:         pauschalOhneDeckel > kostenGesamt,
      summe:             runde(pauschal),
    },
    fahrtenbuch: fahrtenbuch == null ? null : {
      privat_anteil:     privatAnteil,
      summe:             runde(fahrtenbuch),
    },
    break_even_anteil:   breakEven,
    differenz:           differenz == null ? null : runde(differenz),
    empfehlung:          differenz == null ? null : (differenz > 0 ? "fahrtenbuch" : "pauschal"),
    steuer_ersparnis:    ersparnis == null ? null : runde(ersparnis),
  };
}
