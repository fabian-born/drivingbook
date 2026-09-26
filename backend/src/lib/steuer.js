// ============================================================
// Comparison 1% rule ↔ logbook (simplified estimate,
// not tax advice)
//
// Flat rate:    list price (rounded down to full €100) × rate × months
//               + 0.03 % × list price × home–work distance × months
//               (rate reduced proportionally for EVs/hybrids), at most the costs
//               (cost cap)
// Logbook:      costs × share of private kilometers incl. commute
//               (depreciation/leasing for EVs/hybrids reduced like the rate)
// ============================================================

// Monthly flat rate as a percentage of the list price
export const PAUSCHALSATZ = {
  combustion:          1,
  hybrid:              0.5,
  electric:            0.25,
  electric_high_price: 0.5,
};

const runde = betrag => Math.round(betrag * 100) / 100;

// vehicle: { list_price, drive_type }
// kosten:  { total_costs, depreciation, commute_km, months, tax_rate } or null
// km:      { private, commute?, total } (totals from fasseZusammen)
// Returns null as long as list price or costs are missing.
export function steuerVergleich(vehicle, kosten, km) {
  if (vehicle.list_price == null || !kosten) return null;

  const satz   = PAUSCHALSATZ[vehicle.drive_type] ?? 1;
  const faktor = satz / 1;   // share relative to the full 1% rate
  const listenpreis = Math.floor(vehicle.list_price / 100) * 100;

  // Depreciation/leasing counts only proportionally for EVs/hybrids
  const kostenGesamt = kosten.total_costs - kosten.depreciation + kosten.depreciation * faktor;

  const privatnutzung = listenpreis * satz / 100 * kosten.months;
  const arbeitsweg    = listenpreis * 0.03 / 100 * faktor * kosten.commute_km * kosten.months;
  const pauschalOhneDeckel = privatnutzung + arbeitsweg;
  const pauschal = Math.min(pauschalOhneDeckel, kostenGesamt);

  // With a logbook, commute trips are part of private use
  const privatAnteil = km.total > 0 ? (km.private + (km.commute ?? 0)) / km.total : null;
  const fahrtenbuch  = privatAnteil == null ? null : kostenGesamt * privatAnteil;

  // Up to this private share, the logbook is cheaper
  const breakEven = kostenGesamt > 0 ? Math.min(pauschal / kostenGesamt, 1) : null;

  const differenz = fahrtenbuch == null ? null : pauschal - fahrtenbuch;  // > 0 → logbook cheaper
  const ersparnis = differenz == null || kosten.tax_rate == null
    ? null
    : Math.abs(differenz) * kosten.tax_rate / 100;

  return {
    rate:             satz,
    list_price:       listenpreis,
    total_costs:      runde(kostenGesamt),
    flat_rate: {
      private_use:    runde(privatnutzung),
      commute:        runde(arbeitsweg),
      capped:         pauschalOhneDeckel > kostenGesamt,
      total:          runde(pauschal),
    },
    logbook: fahrtenbuch == null ? null : {
      private_share:  privatAnteil,
      total:          runde(fahrtenbuch),
    },
    break_even_share: breakEven,
    difference:       differenz == null ? null : runde(differenz),
    recommendation:   differenz == null ? null : (differenz > 0 ? "logbook" : "flat_rate"),
    tax_savings:      ersparnis == null ? null : runde(ersparnis),
  };
}
