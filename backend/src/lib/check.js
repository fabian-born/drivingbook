// ============================================================
// Check of a year before the tax return
// Flags what could stand out in a tax audit.
// Levels: error (red) · warning (yellow) · info (note only)
// Result: { status: "green" | "yellow" | "red", findings: [...] }
// ============================================================

export const LIMITS = {
  longDistance: 1000,  // km between two trips
  gapDays:      30,     // days without a trip …
  gapKm:        300,    // … while this many km were driven
};

const COORDINATES = /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const km = n => `${n.toLocaleString("de-DE")} km`;

// trips: from loadYearTrips() (one vehicle)
// extra: { edited, deleted, unassigned, now }
export function checkYear(trips, { edited = 0, deleted = 0, unassigned = 0, now = new Date() } = {}) {
  const findingList = [];
  const finding  = (level, type, text, f) => findingList.push({
    level, type, text,
    ...(f ? { trip_id: f.id, timestamp: f.timestamp, odometer_km: f.odometer_km } : {}),
  });

  for (const f of trips) {
    if (f.distance != null && f.distance < 0) {
      finding("error", "odometer_decrease",
        `km-Stand ${km(f.odometer_km)} ist ${km(-f.distance)} kleiner als bei der vorherigen Fahrt.`, f);
    }
    if (new Date(f.timestamp) > now) {
      finding("error", "future", "Fahrt liegt in der Zukunft.", f);
    }

    const gap = f.previous_timestamp ? (new Date(f.timestamp) - new Date(f.previous_timestamp)) / DAY_MS : 0;
    if (gap > LIMITS.gapDays && f.distance > LIMITS.gapKm) {
      finding("warning", "gap",
        `${Math.floor(gap)} Tage ohne Eintrag, dabei ${km(f.distance)} gefahren – fehlen Fahrten?`, f);
    } else if (f.distance > LIMITS.longDistance) {
      finding("warning", "long_distance",
        `${km(f.distance)} seit der vorherigen Fahrt – fehlen dazwischen Fahrten?`, f);
    }

    if (COORDINATES.test(f.destination)) {
      finding("warning", "coordinates", "Ziel ist nur eine Koordinate – bitte Adresse oder Kunde eintragen.", f);
    }
  }

  if (unassigned > 0) {
    finding("warning", "unassigned",
      `${unassigned} Fahrt(en) in diesem Jahr sind keinem Fahrzeug zugeordnet.`);
  }
  if (edited > 0) {
    finding("info", "edited",
      `${edited} Fahrt(en) wurden nachträglich geändert – nachvollziehbar im Änderungsprotokoll.`);
  }
  if (deleted > 0) {
    finding("info", "deleted",
      `${deleted} Fahrt(en) wurden gelöscht – nachvollziehbar im Änderungsprotokoll.`);
  }
  if (trips.length === 0) {
    finding("info", "empty", "In diesem Jahr sind keine Fahrten erfasst.");
  }

  const status = findingList.some(b => b.level === "error") ? "red"
    : findingList.some(b => b.level === "warning") ? "yellow"
    : "green";

  return { status, findings: findingList };
}
