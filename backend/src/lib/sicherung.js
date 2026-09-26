// ============================================================
// Sicherung und Wiederherstellung
//
// Einzelsicherung (Auto-Info):  { format: "drivingbook-fahrzeug", version,
//                                 erstellt_am, fahrzeug, jahre, fahrten, protokoll }
// Gesamtsicherung (Konto):      { format: "drivingbook-sicherung", version,
//                                 erstellt_am, fahrzeuge: [...], ohne_fahrzeug }
//
// Wiederherstellen ergänzt nur: Fahrzeuge werden über ihren Code wieder-
// erkannt (fehlt eins, wird es neu angelegt, der Code bleibt sofern frei),
// vorhandene Fahrten (Zeitpunkt + km-Stand), Jahreskosten und Protokoll-
// einträge bleiben unangetastet. Fahrten, die nach dem Löschen eines
// Fahrzeugs ohne Fahrzeug übrig geblieben sind, werden wieder zugeordnet. Das Änderungsprotokoll wird unverändert
// übernommen; nur Fahrt- und Fahrzeug-IDs werden auf die neuen IDs umgeschrieben.
// ============================================================

import { BACKUP_FORMAT, EXPORT_FORMAT, EXPORT_VERSION } from "../schemas.js";
import { createVehicle } from "./vehicles.js";

const AUDIT_FIELDS = ["kmstand", "ziel", "fahrtart", "timestamp", "vehicle_id"];

// ── Sichern ──────────────────────────────────────────────────

async function fahrzeugDaten(db, userId, vehicleId) {
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
  return { fahrzeug: vehicle.rows[0], jahre: jahre.rows, fahrten: fahrten.rows, protokoll: protokoll.rows };
}

async function merkeSicherung(db, vehicleIds) {
  await db.query(`UPDATE vehicles SET last_backup_at = NOW() WHERE id = ANY($1::int[])`, [vehicleIds]);
}

export async function sichereFahrzeug(db, userId, vehicleId) {
  const daten = await fahrzeugDaten(db, userId, vehicleId);
  if (!daten) return null;
  await merkeSicherung(db, [vehicleId]);
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, erstellt_am: new Date().toISOString(), ...daten };
}

export async function sichereAlles(db, userId) {
  const vehicles = (await db.query(`SELECT id FROM vehicles WHERE user_id = $1 ORDER BY id`, [userId])).rows;
  const fahrzeuge = [];
  for (const v of vehicles) fahrzeuge.push(await fahrzeugDaten(db, userId, v.id));

  const [fahrten, protokoll] = await Promise.all([
    db.query(
      `SELECT id, kmstand, ziel, fahrtart, timestamp
       FROM fahrten WHERE user_id = $1 AND vehicle_id IS NULL ORDER BY timestamp, id`,
      [userId]
    ),
    db.query(
      `SELECT fahrt_id, action, old_data, new_data, source, changed_at
       FROM   fahrten_audit
       WHERE  user_id = $1 AND fahrt_id IN (SELECT id FROM fahrten WHERE user_id = $1 AND vehicle_id IS NULL)
       ORDER  BY changed_at, id`,
      [userId]
    ),
  ]);

  await merkeSicherung(db, vehicles.map(v => v.id));
  return {
    format: BACKUP_FORMAT, version: EXPORT_VERSION, erstellt_am: new Date().toISOString(),
    fahrzeuge,
    ohne_fahrzeug: { fahrten: fahrten.rows, protokoll: protokoll.rows },
  };
}

// ── Wiederherstellen ─────────────────────────────────────────

// Erkennt denselben Protokolleintrag wieder
function auditSchluessel(action, changedAt, oldData, newData) {
  const d = oldData ?? newData ?? {};
  return `${action}|${new Date(changedAt).toISOString()}|${d.timestamp ? new Date(d.timestamp).toISOString() : ""}|${d.kmstand ?? ""}`;
}

// Reserviert n neue Fahrt-IDs aus der Sequenz der Tabelle fahrten
async function neueFahrtIds(db, n) {
  if (n === 0) return [];
  const result = await db.query(
    `SELECT nextval('fahrten_id_seq')::int AS id FROM generate_series(1, $1)`,
    [n]
  );
  return result.rows.map(r => r.id);
}

// Vergibt Fahrt-IDs für einzuspielende Fahrten bzw. Protokolleinträge. Die
// ursprüngliche ID wird wiederverwendet, wenn diese Datenbank sie selbst schon
// vergeben hat (≤ Stand der Sequenz), keine Fahrt sie belegt und ein dort
// vorhandenes Protokoll nachweislich zu genau dieser Fahrt gehört – so hängt
// eine wiederhergestellte Fahrt wieder an ihrem Verlauf. Sonst neue ID.
// Die Sequenz wird nie verstellt (eine präparierte Datei mit riesigen IDs
// könnte sie sonst für alle Benutzer erschöpfen).
async function vergebeFahrtIds(db, userId, alteIds, protokoll) {
  const idMap = new Map();
  if (alteIds.length === 0) return idMap;

  const stand = Number((await db.query(`SELECT last_value, is_called FROM fahrten_id_seq`)).rows
    .map(r => (r.is_called ? r.last_value : Number(r.last_value) - 1))[0]);
  const kandidaten = alteIds.filter(id => id > 0 && id <= stand);

  const [belegt, audits] = await Promise.all([
    db.query(`SELECT id FROM fahrten WHERE id = ANY($1::int[])`, [kandidaten]),
    db.query(
      `SELECT fahrt_id, user_id, action, changed_at, old_data, new_data
       FROM fahrten_audit WHERE fahrt_id = ANY($1::int[])`,
      [kandidaten]
    ),
  ]);
  const belegteIds = new Set(belegt.rows.map(r => r.id));

  const sicherungsSchluessel = new Map();
  for (const e of protokoll) {
    if (!sicherungsSchluessel.has(e.fahrt_id)) sicherungsSchluessel.set(e.fahrt_id, new Set());
    sicherungsSchluessel.get(e.fahrt_id).add(auditSchluessel(e.action, e.changed_at, e.old_data, e.new_data));
  }
  const fremd = new Set();
  for (const a of audits.rows) {
    const passt = a.user_id === userId &&
      sicherungsSchluessel.get(a.fahrt_id)?.has(auditSchluessel(a.action, a.changed_at, a.old_data, a.new_data));
    if (!passt) fremd.add(a.fahrt_id);
  }

  const wiederverwendet = new Set(kandidaten.filter(id => !belegteIds.has(id) && !fremd.has(id)));
  const rest = alteIds.filter(id => !wiederverwendet.has(id));
  for (const id of wiederverwendet) idMap.set(id, id);
  (await neueFahrtIds(db, rest.length)).forEach((id, i) => idMap.set(rest[i], id));
  return idMap;
}

// Protokolldaten auf die bekannten Felder beschränken, Fahrzeug-IDs umschreiben
function mappeAuditDaten(daten, vehicleMap) {
  if (!daten) return null;
  const ergebnis = {};
  for (const feld of AUDIT_FIELDS) {
    if (!(feld in daten)) continue;
    ergebnis[feld] = feld === "vehicle_id"
      ? (vehicleMap.get(daten.vehicle_id) ?? null)
      : daten[feld];
  }
  return ergebnis;
}

// Fahrzeug des Users mit gleichem Code – sonst neu anlegen (Name und Code bleiben, sofern frei).
// Beim vorhandenen Fahrzeug werden nur leere Felder ergänzt.
async function zielFahrzeug(db, userId, fahrzeug) {
  if (fahrzeug.code) {
    const vorhanden = await db.query(
      `UPDATE vehicles
       SET    license_plate = COALESCE(license_plate, $3),
              list_price    = COALESCE(list_price, $4)
       WHERE  user_id = $1 AND code = $2
       RETURNING id`,
      [userId, fahrzeug.code, fahrzeug.license_plate ?? null, fahrzeug.list_price ?? null]
    );
    if (vorhanden.rows.length > 0) return { id: vorhanden.rows[0].id, neu: false };
  }

  const bestehende = await db.query(`SELECT name, is_default FROM vehicles WHERE user_id = $1`, [userId]);
  let name = fahrzeug.name;
  if (bestehende.rows.some(r => r.name === name)) name = `${name} (wiederhergestellt)`.slice(0, 100);
  const isDefault = !bestehende.rows.some(r => r.is_default);

  let vehicle;
  const codeFrei = fahrzeug.code &&
    (await db.query(`SELECT 1 FROM vehicles WHERE code = $1`, [fahrzeug.code])).rows.length === 0;
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
  return { id: vehicle.id, neu: true };
}

// Spielt Jahreskosten, Fahrten und Protokoll in ein Fahrzeug ein (vehicleId null = ohne Fahrzeug).
// bekannteAudits: Set der vorhandenen Protokolleinträge des Users (wird fortgeschrieben)
// alteVehicleId:  ID des Fahrzeugs in der Sicherung (für verwaiste Fahrten)
async function spieleEin(db, userId, { jahre = [], fahrten, protokoll }, vehicleId, vehicleMap, bekannteAudits, alteVehicleId = null) {
  let jahreNeu = 0;
  if (vehicleId != null) {
    for (const j of jahre) {
      const r = await db.query(
        `INSERT INTO vehicle_years (vehicle_id, year, total_costs, depreciation, commute_km, months, tax_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (vehicle_id, year) DO NOTHING`,
        [vehicleId, j.year, j.total_costs, j.depreciation, j.commute_km, j.months, j.tax_rate]
      );
      jahreNeu += r.rowCount;
    }
  }

  // Fahrten (Zeitpunkt + km-Stand) über alle Fahrzeuge des Users wiedererkennen:
  // vorhanden → überspringen (auch wenn sie inzwischen zu einem anderen Fahrzeug
  // gehört); ohne Fahrzeug (Fahrzeug wurde gelöscht) → wieder zuordnen
  const vorhanden = await db.query(
    `SELECT id, timestamp, kmstand, vehicle_id FROM fahrten WHERE user_id = $1`,
    [userId]
  );
  const bekannt = new Map(vorhanden.rows.map(f => [`${f.timestamp.toISOString()}|${f.kmstand}`, f]));

  const neu = [];
  const uebersprungen = new Set();
  const zuordnen = [];
  for (const f of fahrten) {
    const key = `${f.timestamp}|${f.kmstand}`;
    const treffer = bekannt.get(key);
    if (treffer) {
      uebersprungen.add(f.id);
      if (vehicleId != null && treffer.vehicle_id == null) {
        zuordnen.push(treffer.id);
        treffer.vehicle_id = vehicleId;
      }
      continue;
    }
    bekannt.set(key, { vehicle_id: vehicleId });
    neu.push(f);
  }

  if (zuordnen.length > 0) {
    await db.query(`UPDATE fahrten SET vehicle_id = $1 WHERE id = ANY($2::int[])`, [vehicleId, zuordnen]);
    // Protokoll dieser Fahrten zeigt wieder auf das (neue) Fahrzeug
    if (alteVehicleId != null && alteVehicleId !== vehicleId) {
      for (const spalte of ["old_data", "new_data"]) {
        await db.query(
          `UPDATE fahrten_audit SET ${spalte} = jsonb_set(${spalte}, '{vehicle_id}', to_jsonb($1::int))
           WHERE  user_id = $2 AND fahrt_id = ANY($3::int[]) AND (${spalte}->>'vehicle_id')::int = $4`,
          [vehicleId, userId, zuordnen, alteVehicleId]
        );
      }
    }
  }

  // Protokoll: Einträge übersprungener Fahrten und bereits vorhandene Einträge weglassen
  const eintraege = protokoll.filter(e => {
    if (uebersprungen.has(e.fahrt_id)) return false;
    const key = auditSchluessel(e.action, e.changed_at, e.old_data, e.new_data);
    if (bekannteAudits.has(key)) return false;
    bekannteAudits.add(key);
    return true;
  });

  // IDs für neue Fahrten und für Protokolleinträge gelöschter Fahrten
  const alteIds = [...new Set([...neu.map(f => f.id), ...eintraege.map(e => e.fahrt_id)])];
  const idMap   = await vergebeFahrtIds(db, userId, alteIds, protokoll);
  const ids     = neu.map(f => idMap.get(f.id));
  if (neu.length > 0) {
    await db.query(
      `INSERT INTO fahrten (id, user_id, vehicle_id, kmstand, ziel, fahrtart, timestamp)
       SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::text[], $6::text[], $7::timestamptz[])`,
      [ids, neu.map(() => userId), neu.map(() => vehicleId), neu.map(f => f.kmstand),
       neu.map(f => f.ziel), neu.map(f => f.fahrtart), neu.map(f => f.timestamp)]
    );
  }

  if (eintraege.length > 0) {
    await db.query(
      `INSERT INTO fahrten_audit (fahrt_id, user_id, action, old_data, new_data, source, changed_at)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::jsonb[], $5::jsonb[], $6::text[], $7::timestamptz[])`,
      [eintraege.map(e => idMap.get(e.fahrt_id)), eintraege.map(() => userId), eintraege.map(e => e.action),
       eintraege.map(e => e.old_data && JSON.stringify(mappeAuditDaten(e.old_data, vehicleMap))),
       eintraege.map(e => e.new_data && JSON.stringify(mappeAuditDaten(e.new_data, vehicleMap))),
       eintraege.map(e => e.source), eintraege.map(e => e.changed_at)]
    );
  }

  return {
    fahrten: neu.length, zugeordnet: zuordnen.length, uebersprungen: uebersprungen.size - zuordnen.length,
    jahre: jahreNeu, protokoll: eintraege.length,
  };
}

async function bekannteAuditSchluessel(db, userId) {
  const result = await db.query(
    `SELECT action, changed_at, old_data, new_data FROM fahrten_audit WHERE user_id = $1`,
    [userId]
  );
  return new Set(result.rows.map(e => auditSchluessel(e.action, e.changed_at, e.old_data, e.new_data)));
}

// Einzelsicherung wiederherstellen (db: Client in einer Transaktion)
export async function stelleFahrzeugWiederHer(db, userId, daten) {
  const ziel = await zielFahrzeug(db, userId, daten.fahrzeug);
  const vehicleMap = new Map(daten.fahrzeug.id != null ? [[daten.fahrzeug.id, ziel.id]] : []);
  const ergebnis = await spieleEin(db, userId, daten, ziel.id, vehicleMap, await bekannteAuditSchluessel(db, userId), daten.fahrzeug.id ?? null);
  return { vehicle_id: ziel.id, neu: ziel.neu, ...ergebnis };
}

// Gesamtsicherung wiederherstellen (db: Client in einer Transaktion)
export async function stelleAllesWiederHer(db, userId, sicherung) {
  // Erst alle Fahrzeuge zuordnen, damit Umhängungen im Protokoll korrekt abgebildet werden
  const ziele = [];
  const vehicleMap = new Map();
  for (const f of sicherung.fahrzeuge) {
    const ziel = await zielFahrzeug(db, userId, f.fahrzeug);
    ziele.push(ziel);
    if (f.fahrzeug.id != null) vehicleMap.set(f.fahrzeug.id, ziel.id);
  }

  const bekannteAudits = await bekannteAuditSchluessel(db, userId);
  const fahrzeuge = [];
  for (const [i, f] of sicherung.fahrzeuge.entries()) {
    const ergebnis = await spieleEin(db, userId, f, ziele[i].id, vehicleMap, bekannteAudits, f.fahrzeug.id ?? null);
    fahrzeuge.push({ vehicle_id: ziele[i].id, name: f.fahrzeug.name, neu: ziele[i].neu, ...ergebnis });
  }
  const ohneFahrzeug = await spieleEin(db, userId, sicherung.ohne_fahrzeug, null, vehicleMap, bekannteAudits);

  return { fahrzeuge, ohne_fahrzeug: ohneFahrzeug };
}

// ── Erinnerung ───────────────────────────────────────────────

export const ERINNERUNG_TAGE = 30;

// Je Fahrzeug: letzte Sicherung und Änderungen seitdem. Erinnern, wenn es
// Änderungen gibt und die letzte Sicherung (bzw. die Anlage) länger als
// ERINNERUNG_TAGE zurückliegt.
export async function sicherungsStatus(db, userId) {
  const result = await db.query(
    `SELECT v.id, v.name, v.code, v.last_backup_at,
            (SELECT COUNT(*)::int FROM fahrten_audit a
             WHERE  a.user_id = v.user_id
               AND  a.changed_at > COALESCE(v.last_backup_at, '-infinity')
               AND  v.id IN ((a.old_data->>'vehicle_id')::int, (a.new_data->>'vehicle_id')::int)) AS aenderungen,
            COALESCE(v.last_backup_at, v.created_at) < NOW() - make_interval(days => $2) AS faellig
     FROM   vehicles v
     WHERE  v.user_id = $1
     ORDER  BY v.is_default DESC, v.id`,
    [userId, ERINNERUNG_TAGE]
  );
  const fahrzeuge = result.rows.map(({ faellig, ...v }) => ({ ...v, erinnern: faellig && v.aenderungen > 0 }));
  return { erinnerung_tage: ERINNERUNG_TAGE, erinnern: fahrzeuge.some(v => v.erinnern), fahrzeuge };
}
