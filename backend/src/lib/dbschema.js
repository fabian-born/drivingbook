// ============================================================
// Datenbank-Schema: Tabellen-/Spaltennamen und Übersetzung zwischen
// den Feldnamen und Werten der API (deutsch, unverändert – z. B. für
// Home Assistant) und denen der Datenbank.
//
// Alle Zugriffe auf Fahrten und Änderungsprotokoll gehen über dieses
// Modul, damit die API-Namen an genau einer Stelle übersetzt werden.
// ============================================================

// Tabellen, Sequenz und Spalten
export const TAB = {
  fahrten: "fahrten",
  audit:   "fahrten_audit",
  seq:     "fahrten_id_seq",
};

export const COL = {
  kmstand:  "kmstand",
  ziel:     "ziel",
  fahrtart: "fahrtart",
  fahrtId:  "fahrt_id",   // in der Protokoll-Tabelle
};

// Werte: API → Datenbank
const FAHRTART_DB = { privat: "privat", "geschäftlich": "geschäftlich", arbeitsweg: "arbeitsweg" };
const ANTRIEB_DB  = { verbrenner: "verbrenner", hybrid: "hybrid", elektro: "elektro", elektro_teuer: "elektro_teuer" };

const umkehren = map => Object.fromEntries(Object.entries(map).map(([api, db]) => [db, api]));
const FAHRTART_API = umkehren(FAHRTART_DB);
const ANTRIEB_API  = umkehren(ANTRIEB_DB);

export const fahrtartZuDb = v => (v == null ? v : FAHRTART_DB[v] ?? v);
export const fahrtartAusDb = v => (v == null ? v : FAHRTART_API[v] ?? v);
export const antriebZuDb  = v => (v == null ? v : ANTRIEB_DB[v] ?? v);
export const antriebAusDb = v => (v == null ? v : ANTRIEB_API[v] ?? v);

// SQL-Ausdruck, der einen Datenbankwert in den API-Wert übersetzt
function sqlUebersetzung(ausdruck, zuApi) {
  const faelle = Object.entries(zuApi).filter(([db, api]) => db !== api);
  if (faelle.length === 0) return ausdruck;
  const quote = s => `'${s.replace(/'/g, "''")}'`;
  return `(CASE ${ausdruck} ${faelle.map(([db, api]) => `WHEN ${quote(db)} THEN ${quote(api)}`).join(" ")} ELSE ${ausdruck} END)`;
}

export const fahrtartSql = ausdruck => sqlUebersetzung(ausdruck, FAHRTART_API);
export const antriebSql  = ausdruck => sqlUebersetzung(ausdruck, ANTRIEB_API);

// Spaltenliste einer Fahrt mit API-Namen und -Werten.
// alias: Tabellenalias ("f") oder leer
export function fahrtSpalten(alias = "") {
  const p = alias ? `${alias}.` : "";
  return `${p}id, ${p}${COL.kmstand} AS kmstand, ${p}${COL.ziel} AS ziel, ` +
         `${fahrtartSql(p + COL.fahrtart)} AS fahrtart, ${p}timestamp, ${p}vehicle_id`;
}

// Änderungsprotokoll: old_data/new_data enthalten eine Momentaufnahme der Fahrt.
// In der Datenbank mit Datenbank-Namen/-Werten, in der API mit API-Namen/-Werten.
const AUDIT_SCHLUESSEL = [["kmstand", COL.kmstand], ["ziel", COL.ziel], ["fahrtart", COL.fahrtart]];

export function auditZuDb(daten) {
  if (!daten) return daten ?? null;
  const ergebnis = { ...daten };
  for (const [api, db] of AUDIT_SCHLUESSEL) {
    if (!(api in daten)) continue;
    delete ergebnis[api];
    ergebnis[db] = api === "fahrtart" ? fahrtartZuDb(daten[api]) : daten[api];
  }
  return ergebnis;
}

export function auditAusDb(daten) {
  if (!daten) return daten ?? null;
  const ergebnis = { ...daten };
  for (const [api, db] of AUDIT_SCHLUESSEL) {
    if (!(db in daten)) continue;
    delete ergebnis[db];
    ergebnis[api] = api === "fahrtart" ? fahrtartAusDb(daten[db]) : daten[db];
  }
  return ergebnis;
}

// Protokollzeile (aus der DB) für die API aufbereiten
export const auditZeileAusDb = ({ [COL.fahrtId]: fahrtId, old_data, new_data, ...rest }) => ({
  ...rest,
  ...(fahrtId !== undefined ? { fahrt_id: fahrtId } : {}),
  ...(old_data !== undefined ? { old_data: auditAusDb(old_data) } : {}),
  ...(new_data !== undefined ? { new_data: auditAusDb(new_data) } : {}),
});
