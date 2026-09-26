// ============================================================
// Strecken: Fahrten eines Jahres mit gefahrenen Kilometern
// Strecke einer Fahrt = km-Stand minus km-Stand der vorherigen Fahrt
// desselben Fahrzeugs – auch über den Jahreswechsel hinweg. Die erste
// Fahrt eines Fahrzeugs hat keine Strecke (null). Rückschritte im
// km-Stand zählen in den Summen als 0.
// ============================================================

import { TRIP_TYPES } from "../schemas.js";

// Summe: Anzahl Fahrten, km gesamt und km je Fahrtart (business/private/commute)
function leereSumme() {
  const summe = { trips: 0, total: 0 };
  for (const art of TRIP_TYPES) summe[art] = 0;
  return summe;
}

function addiere(summe, fahrt) {
  const km = Math.max(fahrt.distance ?? 0, 0);
  summe.trips++;
  summe.total += km;
  summe[fahrt.trip_type] += km;
}

// vehicleId === null → alle Fahrzeuge (Strecken trotzdem je Fahrzeug)
// Zeilen: id, odometer_km, destination, trip_type, timestamp, vehicle_id,
//         distance, previous_timestamp, vehicle_name, month (YYYY-MM), edited
export async function jahresFahrten(db, { userId, year, vehicleId = null, timezone }) {
  const result = await db.query(
    `WITH strecken AS (
       SELECT f.id, f.odometer_km, f.destination, f.trip_type, f.timestamp, f.vehicle_id,
              f.odometer_km - LAG(f.odometer_km) OVER (PARTITION BY f.vehicle_id ORDER BY f.timestamp, f.id) AS distance,
              LAG(f.timestamp) OVER (PARTITION BY f.vehicle_id ORDER BY f.timestamp, f.id) AS previous_timestamp
       FROM   trips f
       WHERE  f.user_id = $1
         AND  ($4::int IS NULL OR f.vehicle_id = $4)
         AND  f.timestamp < make_timestamptz($2 + 1, 1, 1, 0, 0, 0, $3)
     )
     SELECT s.*, v.name AS vehicle_name,
            TO_CHAR(s.timestamp AT TIME ZONE $3, 'YYYY-MM') AS month,
            EXISTS (SELECT 1 FROM trip_audit a
                    WHERE a.trip_id = s.id AND a.action = 'update') AS edited
     FROM   strecken s
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     WHERE  s.timestamp >= make_timestamptz($2, 1, 1, 0, 0, 0, $3)
     ORDER  BY s.timestamp ASC, s.id ASC`,
    [userId, year, timezone, vehicleId]
  );
  return result.rows;
}

// Monatsübersicht + Jahressumme aus jahresFahrten(): { months, totals }
// start_km/end_km sind nur bei einem einzelnen Fahrzeug aussagekräftig
export function fasseZusammen(fahrten) {
  const monate = new Map();
  const totals = leereSumme();

  for (const f of fahrten) {
    if (!monate.has(f.month)) {
      monate.set(f.month, { month: f.month, start_km: f.odometer_km - (f.distance ?? 0), end_km: f.odometer_km, ...leereSumme() });
    }
    const monat = monate.get(f.month);
    monat.end_km = f.odometer_km;
    addiere(monat, f);
    addiere(totals, f);
  }
  return { months: [...monate.values()], totals };
}
