// ============================================================
// Datenbank aufräumen (Admin): doppelte Fahrten und Fahrten ohne Fahrzeug
//
// Doppelt = gleicher User, gleiches Fahrzeug, gleicher km-Stand, gleiches
// Ziel, gleiche Fahrtart und höchstens DUPLIKAT_SEKUNDEN auseinander
// (typisch: Doppelklick oder doppelt nachgereichte Offline-Fahrt).
// Behalten wird die Fahrt mit dem meisten Änderungsverlauf, bei Gleichstand
// die älteste. Jede Aktion wird mit Quelle "admin" protokolliert.
// ============================================================

import { writeAudit } from "./fahrten.js";

export const DUPLIKAT_SEKUNDEN = 5 * 60;

const FAHRT_FELDER = `f.id, f.user_id, u.username, f.vehicle_id, v.name AS vehicle_name,
                      f.odometer_km, f.destination, f.trip_type, f.timestamp`;

export async function findeDuplikate(db) {
  const kandidaten = (await db.query(
    `SELECT ${FAHRT_FELDER},
            (SELECT COUNT(*)::int FROM trip_audit a WHERE a.trip_id = f.id) AS audit_entries
     FROM   trips f
     JOIN   users u ON u.id = f.user_id
     LEFT JOIN vehicles v ON v.id = f.vehicle_id
     WHERE  EXISTS (
              SELECT 1 FROM trips g
              WHERE  g.id <> f.id AND g.user_id = f.user_id
                AND  g.vehicle_id IS NOT DISTINCT FROM f.vehicle_id
                AND  g.odometer_km = f.odometer_km AND g.trip_type = f.trip_type
                AND  g.destination = f.destination
                AND  ABS(EXTRACT(EPOCH FROM g.timestamp - f.timestamp)) <= $1
            )
     ORDER  BY f.user_id, f.vehicle_id NULLS FIRST, f.odometer_km, f.trip_type, f.destination, f.timestamp, f.id`,
    [DUPLIKAT_SEKUNDEN]
  )).rows;

  // Aufeinanderfolgende Kandidaten mit gleichem Schlüssel und kleinem Zeitabstand bilden eine Gruppe
  const gruppen = [];
  let aktuell = null;
  for (const f of kandidaten) {
    const schluessel = [f.user_id, f.vehicle_id, f.odometer_km, f.trip_type, f.destination].join("|");
    const passt = aktuell && aktuell.schluessel === schluessel &&
      (f.timestamp - aktuell.fahrten.at(-1).timestamp) / 1000 <= DUPLIKAT_SEKUNDEN;
    if (!passt) {
      aktuell = { schluessel, fahrten: [] };
      gruppen.push(aktuell);
    }
    aktuell.fahrten.push(f);
  }

  return gruppen
    .filter(g => g.fahrten.length > 1)
    .map(g => {
      const sortiert = [...g.fahrten].sort((a, b) => b.audit_entries - a.audit_entries || a.id - b.id);
      const [keep, ...remove] = sortiert;
      return {
        user_id: keep.user_id, username: keep.username,
        vehicle_id: keep.vehicle_id, vehicle_name: keep.vehicle_name,
        keep, remove,
      };
    });
}

export async function ohneFahrzeug(db) {
  const result = await db.query(
    `SELECT u.id AS user_id, u.username, COUNT(*)::int AS count,
            MIN(f.timestamp) AS first, MAX(f.timestamp) AS last,
            COALESCE((SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'code', v.code, 'is_default', v.is_default)
                                      ORDER BY v.is_default DESC, v.id)
                      FROM vehicles v WHERE v.user_id = u.id), '[]') AS vehicles
     FROM   trips f
     JOIN   users u ON u.id = f.user_id
     WHERE  f.vehicle_id IS NULL
     GROUP  BY u.id, u.username
     ORDER  BY u.username`
  );
  return result.rows;
}

export async function bericht(db) {
  const [duplikate, ohne] = await Promise.all([findeDuplikate(db), ohneFahrzeug(db)]);
  return {
    duplicate_seconds: DUPLIKAT_SEKUNDEN,
    duplicates: {
      groups:    duplikate,
      to_remove: duplikate.reduce((n, g) => n + g.remove.length, 0),
    },
    unassigned: ohne,
  };
}

const RETURNING = `id, odometer_km, destination, trip_type, timestamp, vehicle_id`;

// Löscht die überzähligen Fahrten aller (oder der angegebenen) Duplikat-Gruppen.
// ids: nur diese Fahrten – jede muss aktuell als „remove“ erkannt sein
// db: Client in einer Transaktion
export async function entferneDuplikate(db, ids = null) {
  const zuEntfernen = (await findeDuplikate(db)).flatMap(g => g.remove.map(f => f.id));
  const auswahl = ids ? zuEntfernen.filter(id => ids.includes(id)) : zuEntfernen;

  for (const id of auswahl) {
    const alt = (await db.query(`DELETE FROM trips WHERE id = $1 RETURNING ${RETURNING}, user_id`, [id])).rows[0];
    await writeAudit(db, { fahrtId: id, userId: alt.user_id, action: "delete", oldRow: alt, source: "admin" });
  }
  return { removed: auswahl.length, rejected: ids ? ids.filter(id => !auswahl.includes(id)) : [] };
}

// Fahrten eines Users ohne Fahrzeug einem seiner Fahrzeuge zuordnen oder löschen
// db: Client in einer Transaktion
// action: "assign" (vehicle_id nötig) oder "delete"
export async function bearbeiteOhneFahrzeug(db, { user_id, action, vehicle_id }) {
  const fahrten = (await db.query(
    `SELECT ${RETURNING} FROM trips WHERE user_id = $1 AND vehicle_id IS NULL FOR UPDATE`,
    [user_id]
  )).rows;

  for (const alt of fahrten) {
    if (action === "assign") {
      const neu = (await db.query(
        `UPDATE trips SET vehicle_id = $1 WHERE id = $2 RETURNING ${RETURNING}`,
        [vehicle_id, alt.id]
      )).rows[0];
      await writeAudit(db, { fahrtId: alt.id, userId: user_id, action: "update", oldRow: alt, newRow: neu, source: "admin" });
    } else {
      await db.query(`DELETE FROM trips WHERE id = $1`, [alt.id]);
      await writeAudit(db, { fahrtId: alt.id, userId: user_id, action: "delete", oldRow: alt, source: "admin" });
    }
  }
  return { count: fahrten.length };
}
