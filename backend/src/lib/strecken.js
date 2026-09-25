// ============================================================
// Strecken: Fahrten eines Jahres mit gefahrenen Kilometern
// Strecke einer Fahrt = km-Stand minus km-Stand der vorherigen Fahrt
// desselben Fahrzeugs – auch über den Jahreswechsel hinweg. Die erste
// Fahrt eines Fahrzeugs hat keine Strecke (null). Rückschritte im
// km-Stand zählen in den Summen als 0.
// ============================================================

import { FAHRTARTEN } from "../schemas.js";

// Schlüssel in den Summen ("geschäftlich" → "geschaeftlich")
const SUMMEN_KEY = { privat: "privat", "geschäftlich": "geschaeftlich", arbeitsweg: "arbeitsweg" };

function leereSumme() {
  const summe = { fahrten: 0, gesamt: 0 };
  for (const art of FAHRTARTEN) summe[SUMMEN_KEY[art]] = 0;
  return summe;
}

function addiere(summe, fahrt) {
  const km = Math.max(fahrt.strecke ?? 0, 0);
  summe.fahrten++;
  summe.gesamt += km;
  summe[SUMMEN_KEY[fahrt.fahrtart]] += km;
}

// vehicleId === null → alle Fahrzeuge (Strecken trotzdem je Fahrzeug)
export async function jahresFahrten(db, { userId, year, vehicleId = null, timezone }) {
  const result = await db.query(
    `WITH strecken AS (
       SELECT f.id, f.kmstand, f.ziel, f.fahrtart, f.timestamp, f.vehicle_id,
              f.kmstand - LAG(f.kmstand) OVER (PARTITION BY f.vehicle_id ORDER BY f.timestamp, f.id) AS strecke,
              LAG(f.timestamp) OVER (PARTITION BY f.vehicle_id ORDER BY f.timestamp, f.id) AS vorher_timestamp
       FROM   fahrten f
       WHERE  f.user_id = $1
         AND  ($4::int IS NULL OR f.vehicle_id = $4)
         AND  f.timestamp < make_timestamptz($2 + 1, 1, 1, 0, 0, 0, $3)
     )
     SELECT s.*, v.name AS vehicle_name,
            TO_CHAR(s.timestamp AT TIME ZONE $3, 'YYYY-MM') AS monat,
            EXISTS (SELECT 1 FROM fahrten_audit a
                    WHERE a.fahrt_id = s.id AND a.action = 'update') AS edited
     FROM   strecken s
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     WHERE  s.timestamp >= make_timestamptz($2, 1, 1, 0, 0, 0, $3)
     ORDER  BY s.timestamp ASC, s.id ASC`,
    [userId, year, timezone, vehicleId]
  );
  return result.rows;
}

// Monatsübersicht + Jahressumme aus jahresFahrten()
// start_km/end_km sind nur bei einem einzelnen Fahrzeug aussagekräftig
export function fasseZusammen(fahrten) {
  const monate = new Map();
  const summe  = leereSumme();

  for (const f of fahrten) {
    if (!monate.has(f.monat)) {
      monate.set(f.monat, { monat: f.monat, start_km: f.kmstand - (f.strecke ?? 0), end_km: f.kmstand, ...leereSumme() });
    }
    const monat = monate.get(f.monat);
    monat.end_km = f.kmstand;
    addiere(monat, f);
    addiere(summe, f);
  }
  return { monate: [...monate.values()], summe };
}
