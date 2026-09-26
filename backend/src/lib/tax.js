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
export const FLAT_RATE = {
  combustion:          1,
  hybrid:              0.5,
  electric:            0.25,
  electric_high_price: 0.5,
};

const roundTo = amount => Math.round(amount * 100) / 100;

// vehicle: { list_price, drive_type }
// costs:   { total_costs, depreciation, commute_km, months, tax_rate } or null
// km:      { private, commute?, total } (totals from summarize)
// Returns null as long as list price or costs are missing.
export function taxComparison(vehicle, costs, km) {
  if (vehicle.list_price == null || !costs) return null;

  const rate   = FLAT_RATE[vehicle.drive_type] ?? 1;
  const factor = rate / 1;   // share relative to the full 1% rate
  const listPrice = Math.floor(vehicle.list_price / 100) * 100;

  // Depreciation/leasing counts only proportionally for EVs/hybrids
  const totalCosts = costs.total_costs - costs.depreciation + costs.depreciation * factor;

  const privateUse = listPrice * rate / 100 * costs.months;
  const arbeitsweg    = listPrice * 0.03 / 100 * factor * costs.commute_km * costs.months;
  const flatRateUncapped = privateUse + arbeitsweg;
  const flatRate = Math.min(flatRateUncapped, totalCosts);

  // With a logbook, commute trips are part of private use
  const privateShare = km.total > 0 ? (km.private + (km.commute ?? 0)) / km.total : null;
  const logbookCost  = privateShare == null ? null : totalCosts * privateShare;

  // Up to this private share, the logbook is cheaper
  const breakEven = totalCosts > 0 ? Math.min(flatRate / totalCosts, 1) : null;

  const diff = logbookCost == null ? null : flatRate - logbookCost;  // > 0 → logbook cheaper
  const savings = diff == null || costs.tax_rate == null
    ? null
    : Math.abs(diff) * costs.tax_rate / 100;

  return {
    rate:             rate,
    list_price:       listPrice,
    total_costs:      roundTo(totalCosts),
    flat_rate: {
      private_use:    roundTo(privateUse),
      commute:        roundTo(arbeitsweg),
      capped:         flatRateUncapped > totalCosts,
      total:          roundTo(flatRate),
    },
    logbook: logbookCost == null ? null : {
      private_share:  privateShare,
      total:          roundTo(logbookCost),
    },
    break_even_share: breakEven,
    difference:       diff == null ? null : roundTo(diff),
    recommendation:   diff == null ? null : (diff > 0 ? "logbook" : "flat_rate"),
    tax_savings:      savings == null ? null : roundTo(savings),
  };
}
