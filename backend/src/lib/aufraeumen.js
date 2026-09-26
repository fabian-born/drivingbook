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
import { COL, TAB, fahrtSpalten, fahrtartSql } from "./dbschema.js";

export const DUPLIKAT_SEKUNDEN = 5 * 60;

const FAHRT_FELDER = `f.id, f.user_id, u.username, f.vehicle_id, v.name AS vehicle_name,
                      f.${COL.kmstand} AS kmstand, f.${COL.ziel} AS ziel,
                      ${fahrtartSql(`f.${COL.fahrtart}`)} AS fahrtart, f.timestamp`;

export async function findeDuplikate(db) {
  const kandidaten = (await db.query(
    `SELECT ${FAHRT_FELDER},
            (SELECT COUNT(*)::int FROM ${TAB.audit} a WHERE a.${COL.fahrtId} = f.id) AS protokoll
     FROM   ${TAB.fahrten} f
     JOIN   users u ON u.id = f.user_id
     LEFT JOIN vehicles v ON v.id = f.vehicle_id
     WHERE  EXISTS (
              SELECT 1 FROM ${TAB.fahrten} g
              WHERE  g.id <> f.id AND g.user_id = f.user_id
                AND  g.vehicle_id IS NOT DISTINCT FROM f.vehicle_id
                AND  g.${COL.kmstand} = f.${COL.kmstand} AND g.${COL.fahrtart} = f.${COL.fahrtart}
                AND  g.${COL.ziel} = f.${COL.ziel}
                AND  ABS(EXTRACT(EPOCH FROM g.timestamp - f.timestamp)) <= $1
            )
     ORDER  BY f.user_id, f.vehicle_id NULLS FIRST, f.${COL.kmstand}, f.${COL.fahrtart}, f.${COL.ziel}, f.timestamp, f.id`,
    [DUPLIKAT_SEKUNDEN]
  )).rows;

  // Aufeinanderfolgende Kandidaten mit gleichem Schlüssel und kleinem Zeitabstand bilden eine Gruppe
  const gruppen = [];
  let aktuell = null;
  for (const f of kandidaten) {
    const schluessel = [f.user_id, f.vehicle_id, f.kmstand, f.fahrtart, f.ziel].join("|");
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
      const sortiert = [...g.fahrten].sort((a, b) => b.protokoll - a.protokoll || a.id - b.id);
      const [behalten, ...entfernen] = sortiert;
      return {
        user_id: behalten.user_id, username: behalten.username,
        vehicle_id: behalten.vehicle_id, vehicle_name: behalten.vehicle_name,
        behalten, entfernen,
      };
    });
}

export async function ohneFahrzeug(db) {
  const result = await db.query(
    `SELECT u.id AS user_id, u.username, COUNT(*)::int AS anzahl,
            MIN(f.timestamp) AS erste, MAX(f.timestamp) AS letzte,
            COALESCE((SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'code', v.code, 'is_default', v.is_default)
                                      ORDER BY v.is_default DESC, v.id)
                      FROM vehicles v WHERE v.user_id = u.id), '[]') AS fahrzeuge
     FROM   ${TAB.fahrten} f
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
    duplikat_sekunden: DUPLIKAT_SEKUNDEN,
    duplikate: {
      gruppen: duplikate,
      zu_entfernen: duplikate.reduce((n, g) => n + g.entfernen.length, 0),
    },
    ohne_fahrzeug: ohne,
  };
}

const RETURNING = fahrtSpalten();

// Löscht die überzähligen Fahrten aller (oder der angegebenen) Duplikat-Gruppen.
// ids: nur diese Fahrten – jede muss aktuell als „entfernen“ erkannt sein
// db: Client in einer Transaktion
export async function entferneDuplikate(db, ids = null) {
  const zuEntfernen = (await findeDuplikate(db)).flatMap(g => g.entfernen.map(f => f.id));
  const auswahl = ids ? zuEntfernen.filter(id => ids.includes(id)) : zuEntfernen;

  for (const id of auswahl) {
    const alt = (await db.query(`DELETE FROM ${TAB.fahrten} WHERE id = $1 RETURNING ${RETURNING}, user_id`, [id])).rows[0];
    await writeAudit(db, { fahrtId: id, userId: alt.user_id, action: "delete", oldRow: alt, source: "admin" });
  }
  return { entfernt: auswahl.length, abgelehnt: ids ? ids.filter(id => !auswahl.includes(id)) : [] };
}

// Fahrten eines Users ohne Fahrzeug einem seiner Fahrzeuge zuordnen oder löschen
// db: Client in einer Transaktion
export async function bearbeiteOhneFahrzeug(db, { user_id, aktion, vehicle_id }) {
  const fahrten = (await db.query(
    `SELECT ${RETURNING} FROM ${TAB.fahrten} WHERE user_id = $1 AND vehicle_id IS NULL FOR UPDATE`,
    [user_id]
  )).rows;

  for (const alt of fahrten) {
    if (aktion === "zuordnen") {
      const neu = (await db.query(
        `UPDATE ${TAB.fahrten} SET vehicle_id = $1 WHERE id = $2 RETURNING ${RETURNING}`,
        [vehicle_id, alt.id]
      )).rows[0];
      await writeAudit(db, { fahrtId: alt.id, userId: user_id, action: "update", oldRow: alt, newRow: neu, source: "admin" });
    } else {
      await db.query(`DELETE FROM ${TAB.fahrten} WHERE id = $1`, [alt.id]);
      await writeAudit(db, { fahrtId: alt.id, userId: user_id, action: "delete", oldRow: alt, source: "admin" });
    }
  }
  return { anzahl: fahrten.length };
}
