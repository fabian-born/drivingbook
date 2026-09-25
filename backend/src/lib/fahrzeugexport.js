// ============================================================
// Export / Import aller Daten eines Fahrzeugs
// Format: { format, version, exportiert_am, fahrzeug, jahre, fahrten, protokoll }
//
// Beim Import bekommen Fahrten neue IDs; das Änderungsprotokoll wird
// darauf umgeschrieben (auch Einträge gelöschter Fahrten). Importierte
// Protokolleinträge tragen die Quelle "import:<ursprung>", Fahrten ohne
// mitgelieferten Verlauf einen "create"-Eintrag mit Quelle "import" –
// so bleibt für eine Prüfung sichtbar, was importiert wurde.
// ============================================================

import { EXPORT_FORMAT, EXPORT_VERSION } from "../schemas.js";
import { createVehicle } from "./vehicles.js";

const AUDIT_FIELDS = ["kmstand", "ziel", "fahrtart", "timestamp", "vehicle_id"];

export async function exportiereFahrzeug(db, userId, vehicleId) {
  const [vehicle, jahre, fahrten, protokoll] = await Promise.all([
    db.query(
      `SELECT id, name, code, license_plate, list_price::float8 AS list_price, drive_type
       FROM vehicles WHERE id = $1 AND user_id = $2`,
      [vehicleId, userId]
    ),
    db.query(
      `SELECT year, total_costs::float8 AS total_costs, depreciation::float8 AS depreciation,
              commute_km::float8 AS commute_km, months, tax_rate::float8 AS tax_rate
       FROM vehicle_years WHERE vehicle_id = $1 ORDER BY year`,
      [vehicleId]
    ),
    db.query(
      `SELECT id, kmstand, ziel, fahrtart, timestamp
       FROM fahrten WHERE user_id = $1 AND vehicle_id = $2 ORDER BY timestamp, id`,
      [userId, vehicleId]
    ),
    // Auch Einträge gelöschter oder umgehängter Fahrten dieses Fahrzeugs
    db.query(
      `SELECT fahrt_id, action, old_data, new_data, source, changed_at
       FROM   fahrten_audit
       WHERE  user_id = $1
         AND  (fahrt_id IN (SELECT id FROM fahrten WHERE user_id = $1 AND vehicle_id = $2)
               OR (old_data->>'vehicle_id')::int = $2
               OR (new_data->>'vehicle_id')::int = $2)
       ORDER  BY changed_at, id`,
      [userId, vehicleId]
    ),
  ]);
  if (vehicle.rows.length === 0) return null;

  return {
    format:        EXPORT_FORMAT,
    version:       EXPORT_VERSION,
    exportiert_am: new Date().toISOString(),
    fahrzeug:      vehicle.rows[0],
    jahre:         jahre.rows,
    fahrten:       fahrten.rows,
    protokoll:     protokoll.rows,
  };
}

// Erkennt denselben Protokolleintrag wieder (für das Zusammenführen)
function auditSchluessel(action, changedAt, oldData, newData) {
  const d = oldData ?? newData ?? {};
  return `${action}|${new Date(changedAt).toISOString()}|${d.timestamp ? new Date(d.timestamp).toISOString() : ""}|${d.kmstand ?? ""}`;
}

// Reserviert n neue Fahrt-IDs aus der Sequenz der Tabelle fahrten
async function neueFahrtIds(db, n) {
  if (n === 0) return [];
  const result = await db.query(
    `SELECT nextval(pg_get_serial_sequence('fahrten', 'id'))::int AS id FROM generate_series(1, $1)`,
    [n]
  );
  return result.rows.map(r => r.id);
}

// Protokolldaten auf die bekannten Felder beschränken, Fahrzeug-ID umschreiben
function mappeAuditDaten(daten, alteVehicleId, neueVehicleId) {
  if (!daten) return null;
  const ergebnis = {};
  for (const feld of AUDIT_FIELDS) {
    if (!(feld in daten)) continue;
    ergebnis[feld] = feld === "vehicle_id"
      ? (daten.vehicle_id != null && daten.vehicle_id === alteVehicleId ? neueVehicleId : null)
      : daten[feld];
  }
  return ergebnis;
}

// Legt ein neues Fahrzeug aus den Exportdaten an. Name und Code bleiben
// erhalten, sofern sie frei sind.
async function legeFahrzeugAn(db, userId, fahrzeug) {
  const vorhanden = await db.query(`SELECT name, is_default FROM vehicles WHERE user_id = $1`, [userId]);
  const namen = new Set(vorhanden.rows.map(r => r.name));
  let name = fahrzeug.name;
  if (namen.has(name)) name = `${name} (Import)`.slice(0, 100);
  const isDefault = !vorhanden.rows.some(r => r.is_default);

  let vehicle;
  const codeFrei = fahrzeug.code && (await db.query(`SELECT 1 FROM vehicles WHERE code = $1`, [fahrzeug.code])).rows.length === 0;
  if (codeFrei) {
    vehicle = (await db.query(
      `INSERT INTO vehicles (user_id, name, code, is_default) VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, name, fahrzeug.code, isDefault]
    )).rows[0];
  } else {
    vehicle = await createVehicle(db, userId, name, isDefault);
  }

  await db.query(
    `UPDATE vehicles SET license_plate = $2, list_price = $3, drive_type = $4 WHERE id = $1`,
    [vehicle.id, fahrzeug.license_plate ?? null, fahrzeug.list_price ?? null, fahrzeug.drive_type ?? "verbrenner"]
  );
  return vehicle.id;
}

// daten: validierter importBody; zielVehicleId: bestehendes Fahrzeug (Zusammenführen) oder null (neu)
// db: Client in einer Transaktion
export async function importiereFahrzeug(db, userId, daten, zielVehicleId = null) {
  const vehicleId = zielVehicleId ?? await legeFahrzeugAn(db, userId, daten.fahrzeug);
  const alteVehicleId = daten.fahrzeug.id ?? null;

  // Jahreskosten: beim Zusammenführen vorhandene Jahre nicht überschreiben
  let jahre = 0;
  for (const j of daten.jahre) {
    const r = await db.query(
      `INSERT INTO vehicle_years (vehicle_id, year, total_costs, depreciation, commute_km, months, tax_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (vehicle_id, year) DO NOTHING`,
      [vehicleId, j.year, j.total_costs, j.depreciation, j.commute_km, j.months, j.tax_rate]
    );
    jahre += r.rowCount;
  }

  // Fahrten: beim Zusammenführen gleiche Fahrten (Zeitpunkt + km-Stand) überspringen
  const bekannt = new Set();
  if (zielVehicleId) {
    const vorhanden = await db.query(
      `SELECT timestamp, kmstand FROM fahrten WHERE user_id = $1 AND vehicle_id = $2`,
      [userId, vehicleId]
    );
    for (const f of vorhanden.rows) bekannt.add(`${f.timestamp.toISOString()}|${f.kmstand}`);
  }
  const neu = [];
  const uebersprungen = new Set();
  for (const f of daten.fahrten) {
    const key = `${f.timestamp}|${f.kmstand}`;
    if (bekannt.has(key)) { uebersprungen.add(f.id); continue; }
    bekannt.add(key);
    neu.push(f);
  }

  const idMap = new Map();
  const ids = await neueFahrtIds(db, neu.length);
  neu.forEach((f, i) => idMap.set(f.id, ids[i]));
  if (neu.length > 0) {
    await db.query(
      `INSERT INTO fahrten (id, user_id, vehicle_id, kmstand, ziel, fahrtart, timestamp)
       SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::text[], $6::text[], $7::timestamptz[])`,
      [ids, neu.map(() => userId), neu.map(() => vehicleId), neu.map(f => f.kmstand),
       neu.map(f => f.ziel), neu.map(f => f.fahrtart), neu.map(f => f.timestamp)]
    );
  }

  // Änderungsprotokoll: beim Zusammenführen bereits vorhandene Einträge
  // (z. B. gelöschter Fahrten) nicht doppelt übernehmen
  const vorhandeneEintraege = new Set();
  if (zielVehicleId) {
    const vorhanden = await db.query(
      `SELECT action, changed_at, old_data, new_data FROM fahrten_audit
       WHERE  user_id = $1
         AND  $2 IN ((old_data->>'vehicle_id')::int, (new_data->>'vehicle_id')::int)`,
      [userId, vehicleId]
    );
    for (const e of vorhanden.rows) vorhandeneEintraege.add(auditSchluessel(e.action, e.changed_at, e.old_data, e.new_data));
  }

  // IDs gelöschter Fahrten ebenfalls neu vergeben
  const eintraege = daten.protokoll.filter(e =>
    !uebersprungen.has(e.fahrt_id) &&
    !vorhandeneEintraege.has(auditSchluessel(e.action, e.changed_at, e.old_data, e.new_data)));
  const unbekannt = [...new Set(eintraege.map(e => e.fahrt_id).filter(id => !idMap.has(id)))];
  (await neueFahrtIds(db, unbekannt.length)).forEach((id, i) => idMap.set(unbekannt[i], id));

  const mitVerlauf = new Set(eintraege.map(e => e.fahrt_id));
  const protokoll = [
    ...eintraege.map(e => ({
      fahrt_id: idMap.get(e.fahrt_id), action: e.action,
      old_data: mappeAuditDaten(e.old_data, alteVehicleId, vehicleId),
      new_data: mappeAuditDaten(e.new_data, alteVehicleId, vehicleId),
      source: `import:${e.source}`.slice(0, 20), changed_at: e.changed_at,
    })),
    // Fahrten ohne mitgelieferten Verlauf: Herkunft festhalten
    ...neu.filter(f => !mitVerlauf.has(f.id)).map(f => ({
      fahrt_id: idMap.get(f.id), action: "create", old_data: null,
      new_data: { kmstand: f.kmstand, ziel: f.ziel, fahrtart: f.fahrtart, timestamp: f.timestamp, vehicle_id: vehicleId },
      source: "import", changed_at: new Date().toISOString(),
    })),
  ];
  if (protokoll.length > 0) {
    await db.query(
      `INSERT INTO fahrten_audit (fahrt_id, user_id, action, old_data, new_data, source, changed_at)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::jsonb[], $5::jsonb[], $6::text[], $7::timestamptz[])`,
      [protokoll.map(e => e.fahrt_id), protokoll.map(() => userId), protokoll.map(e => e.action),
       protokoll.map(e => e.old_data && JSON.stringify(e.old_data)), protokoll.map(e => e.new_data && JSON.stringify(e.new_data)),
       protokoll.map(e => e.source), protokoll.map(e => e.changed_at)]
    );
  }

  return {
    vehicle_id: vehicleId,
    importiert: { fahrten: neu.length, uebersprungen: uebersprungen.size, jahre, protokoll: protokoll.length },
  };
}
