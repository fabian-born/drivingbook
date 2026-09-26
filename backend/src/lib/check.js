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

import { DEFAULT_LANGUAGE, localeOf, translate } from "../i18n.js";

const COORDINATES = /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// trips: from loadYearTrips() (one vehicle)
// extra: { edited, deleted, unassigned, now, language }  (texts in `language`)
export function checkYear(trips, { edited = 0, deleted = 0, unassigned = 0, now = new Date(), language = DEFAULT_LANGUAGE } = {}) {
  const km = n => `${n.toLocaleString(localeOf(language))} km`;
  const findingList = [];
  const finding  = (level, type, params, f) => findingList.push({
    level, type, text: translate(language, `check.${type}`, params),
    ...(f ? { trip_id: f.id, timestamp: f.timestamp, odometer_km: f.odometer_km } : {}),
  });

  for (const f of trips) {
    if (f.distance != null && f.distance < 0) {
      finding("error", "odometer_decrease", { km: km(f.odometer_km), diff: km(-f.distance) }, f);
    }
    if (new Date(f.timestamp) > now) {
      finding("error", "future", {}, f);
    }

    const gap = f.previous_timestamp ? (new Date(f.timestamp) - new Date(f.previous_timestamp)) / DAY_MS : 0;
    if (gap > LIMITS.gapDays && f.distance > LIMITS.gapKm) {
      finding("warning", "gap", { days: Math.floor(gap), km: km(f.distance) }, f);
    } else if (f.distance > LIMITS.longDistance) {
      finding("warning", "long_distance", { km: km(f.distance) }, f);
    }

    if (COORDINATES.test(f.destination)) {
      finding("warning", "coordinates", {}, f);
    }
  }

  if (unassigned > 0) {
    finding("warning", "unassigned", { count: Number(unassigned) });
  }
  if (edited > 0) {
    finding("info", "edited", { count: Number(edited) });
  }
  if (deleted > 0) {
    finding("info", "deleted", { count: Number(deleted) });
  }
  if (trips.length === 0) {
    finding("info", "empty", {});
  }

  const status = findingList.some(b => b.level === "error") ? "red"
    : findingList.some(b => b.level === "warning") ? "yellow"
    : "green";

  return { status, findings: findingList };
}
