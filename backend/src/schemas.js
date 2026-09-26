// ============================================================
// Eingabe-Schemas (zod)
// Unbekannte Felder werden verworfen, Strings getrimmt.
// ============================================================

import { z } from "zod";

export const TRIP_TYPES  = ["business", "private", "commute"];
const MAX_INT            = 2147483647;  // Obergrenze von PostgreSQL INTEGER

// Zahl oder rein numerischer String (Formulare senden Strings)
const numeric = schema => z.preprocess(
  v => (typeof v === "string" && /^\s*\d+\s*$/.test(v)) ? Number(v) : v,
  schema
);

const text = (msg, max) =>
  z.string({ error: msg }).trim().min(1, { error: msg }).max(max, { error: `Höchstens ${max} Zeichen erlaubt` });

// ── Parameter ────────────────────────────────────────────────
export const idParam = z.object({
  id: z.string().regex(/^\d{1,9}$/, { error: "Ungültige ID" }).transform(Number),
});

export const yearParam = z.object({
  year: z.string().regex(/^\d{4}$/, { error: "Ungültiges Jahr" }).transform(Number),
});

// ?vehicle=CODE schränkt Abfragen auf ein Fahrzeug ein; ohne Angabe: alle Fahrzeuge
const vehicleFilter = z.string().trim().toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, { error: "Ungültiger Fahrzeug-Code" }).optional();

export const vehicleQuery = z.object({ vehicle: vehicleFilter });

export const monthQuery = z.object({
  month: z.string({ error: "Query-Parameter 'month' erforderlich (YYYY-MM)" })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Query-Parameter 'month' erforderlich (YYYY-MM)" }),
  vehicle: vehicleFilter,
});

export const yearQuery = z.object({
  year: z.string({ error: "Query-Parameter 'year' erforderlich (YYYY)" })
    .regex(/^\d{4}$/, { error: "Query-Parameter 'year' erforderlich (YYYY)" }).transform(Number),
  vehicle: vehicleFilter,
});

export const auditQuery = z.object({
  year: z.string().regex(/^\d{4}$/, { error: "Query-Parameter 'year' erforderlich (YYYY)" }).transform(Number),
  vehicle: vehicleFilter,
});

// ── Fahrten ──────────────────────────────────────────────────
const KM_MSG = "km-Stand muss eine ganze Zahl ≥ 0 sein";
const TS_MSG = "Ungültiger Zeitpunkt";

const zeitpunkt = z.union([z.string(), z.number()], { error: TS_MSG }).transform((v, ctx) => {
  const d = new Date(v);
  if (isNaN(d)) {
    ctx.issues.push({ code: "custom", message: TS_MSG, input: v });
    return z.NEVER;
  }
  return d.toISOString();
});
const kmStand = numeric(
  z.number({ error: KM_MSG }).int({ error: KM_MSG }).min(0, { error: KM_MSG }).max(MAX_INT, { error: KM_MSG })
);

export const tripFields = {
  odometer_km: kmStand,
  destination: text("Ziel darf nicht leer sein", 500),
  trip_type:   z.enum(TRIP_TYPES, { error: `Fahrtart muss einer der Werte sein: ${TRIP_TYPES.join(", ")}` }),
  timestamp:   zeitpunkt,
};

// vehicle_code ist immer optional; null entfernt die Zuordnung,
// fehlt das Feld komplett wird das Default-Fahrzeug verwendet (nur beim Anlegen)
const vehicleCode = z.union(
  [z.null(), z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, { error: "Ungültiger Fahrzeug-Code" })],
  { error: "Ungültiger Fahrzeug-Code" }
).optional();

// force: true speichert trotz Warnung der km-Plausibilitätsprüfung
const force = z.boolean({ error: "force muss true oder false sein" }).optional();

export const tripCreate = z.object({ ...tripFields, vehicle_code: vehicleCode, force });
export const tripUpdate = z.object({ ...tripFields, vehicle_code: vehicleCode, force }).partial();

// Übergang für Home Assistant: POST /api/fahrt mit den früheren deutschen Feldern
export const LEGACY_TRIP_TYPES = { privat: "private", "geschäftlich": "business", arbeitsweg: "commute" };
export const legacyTripCreate = z.object({
  kmstand:  kmStand,
  ziel:     text("Ziel darf nicht leer sein", 500),
  fahrtart: z.enum(Object.keys(LEGACY_TRIP_TYPES), { error: `fahrtart muss einer der Werte sein: ${Object.keys(LEGACY_TRIP_TYPES).join(", ")}` }),
  timestamp: zeitpunkt,
  vehicle_code: vehicleCode,
  force,
}).transform(({ kmstand, ziel, fahrtart, ...rest }) => ({
  ...rest, odometer_km: kmstand, destination: ziel, trip_type: LEGACY_TRIP_TYPES[fahrtart],
}));

// ── Auth & Benutzer ──────────────────────────────────────────
const PASSWORD_MSG = "Passwort muss mindestens 8 Zeichen haben";
// bcrypt verarbeitet höchstens 72 Byte; längere Eingaben sind nutzlos
const password = z.string({ error: PASSWORD_MSG }).min(8, { error: PASSWORD_MSG })
  .max(72, { error: "Passwort darf höchstens 72 Zeichen haben" });
// Benutzernamen werden immer klein geschrieben gespeichert und verglichen
const username = text("Benutzername und Passwort erforderlich", 100).toLowerCase();

export const loginBody = z.object({
  username: z.string({ error: "Benutzername und Passwort erforderlich" }).trim().toLowerCase()
    .min(1, { error: "Benutzername und Passwort erforderlich" }),
  password: z.string({ error: "Benutzername und Passwort erforderlich" }).min(1, { error: "Benutzername und Passwort erforderlich" }),
});

export const registerBody = z.object({
  username,
  password,
  vehicleName:  z.string().trim().max(100).optional(),
  vehicle_name: z.string().trim().max(100).optional(),   // ältere API-Clients
}).transform(({ vehicleName, vehicle_name, ...rest }) => ({
  ...rest,
  vehicleName: vehicleName || vehicle_name || "Fahrzeug 1",
}));

export const createUserBody = z.object({
  username,
  password,
  // Unbekannte Rollen werden wie bisher zu "user"
  role: z.unknown().optional().transform(r => (r === "admin" ? "admin" : "user")),
});

export const changePasswordBody = z.object({
  currentPassword: z.string({ error: "Altes und neues Passwort erforderlich" }).min(1, { error: "Altes und neues Passwort erforderlich" }),
  newPassword: z.string({ error: "Altes und neues Passwort erforderlich" })
    .min(8, { error: "Neues Passwort muss mindestens 8 Zeichen haben" })
    .max(72, { error: "Passwort darf höchstens 72 Zeichen haben" }),
});

// ── Fahrzeuge & Tokens ───────────────────────────────────────
export const vehicleBody = z.object({
  name: text("Name erforderlich", 100),
  is_default: z.unknown().optional().transform(v => v === true),
});

export const tokenBody = z.object({
  label: z.string().trim().max(100, { error: "Höchstens 100 Zeichen erlaubt" }).optional()
    .transform(l => l || "API Token"),
  is_default: z.unknown().optional().transform(v => v === true),
});

// ── Auto-Info ────────────────────────────────────────────────
export const DRIVE_TYPES = ["combustion", "hybrid", "electric", "electric_high_price"];
export const LEGACY_DRIVE_TYPES = { verbrenner: "combustion", hybrid: "hybrid", elektro: "electric", elektro_teuer: "electric_high_price" };

// Dezimalzahl; Formulare senden Strings, ggf. mit Komma ("1.234,56" oder "1234,56").
// Leerer String → null
const decimal = (msg, max) => z.preprocess(
  v => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    if (s === "") return null;
    // "1.234,56" / "1234,56" (deutsch), "45.000" (Tausenderpunkt ohne Komma), "1234.5"
    const normalisiert = s.includes(",")
      ? s.replace(/\./g, "").replace(",", ".")
      : (/^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
    return /^\d+(\.\d+)?$/.test(normalisiert) ? Number(normalisiert) : v;
  },
  z.number({ error: msg }).min(0, { error: msg }).max(max, { error: msg }).nullable()
);

export const vehicleUpdateBody = z.object({
  name:          text("Name erforderlich", 100).optional(),
  license_plate: z.string({ error: "Ungültiges Kennzeichen" }).trim().toUpperCase()
    .max(20, { error: "Höchstens 20 Zeichen erlaubt" }).nullable().optional()
    .transform(v => (v === "" ? null : v)),
  list_price:    decimal("Listenpreis muss eine Zahl ≥ 0 sein", 10_000_000).optional(),
  drive_type:    z.enum(DRIVE_TYPES, { error: `Antrieb muss einer der Werte sein: ${DRIVE_TYPES.join(", ")}` }).optional(),
});

export const vehicleYearParam = z.object({
  id:   z.string().regex(/^\d{1,9}$/, { error: "Ungültige ID" }).transform(Number),
  year: z.string().regex(/^\d{4}$/, { error: "Ungültiges Jahr" }).transform(Number),
});

export const infoQuery = z.object({
  year: z.string().regex(/^\d{4}$/, { error: "Ungültiges Jahr" }).transform(Number).optional(),
});

export const vehicleYearBody = z.object({
  total_costs:  decimal("Gesamtkosten müssen eine Zahl ≥ 0 sein", 10_000_000)
    .refine(v => v != null, { error: "Gesamtkosten erforderlich" }),
  depreciation: decimal("AfA/Leasing muss eine Zahl ≥ 0 sein", 10_000_000).optional()
    .transform(v => v ?? 0),
  commute_km:   decimal("Entfernung muss eine Zahl zwischen 0 und 1000 sein", 1000).optional()
    .transform(v => v ?? 0),
  months:       numeric(z.number({ error: "Monate müssen zwischen 1 und 12 liegen" }).int()
    .min(1, { error: "Monate müssen zwischen 1 und 12 liegen" }).max(12, { error: "Monate müssen zwischen 1 und 12 liegen" }))
    .optional().transform(v => v ?? 12),
  tax_rate:     decimal("Steuersatz muss zwischen 0 und 60 % liegen", 60).optional()
    .transform(v => v ?? null),
}).refine(d => d.depreciation <= d.total_costs, { error: "AfA/Leasing darf die Gesamtkosten nicht übersteigen" });

// ── Sicherung: einzelnes Fahrzeug oder ganzes Konto ─────────
// Format v2 (englisch). Dateien im Format v1 (deutsch, bis 09/2026) übersetzt
// lib/altformat.js vor der Prüfung in v2.
export const VEHICLE_BACKUP_FORMAT = "drivingbook-vehicle";   // Einzelsicherung (Auto-Info)
export const BACKUP_FORMAT         = "drivingbook-backup";    // Gesamtsicherung (Konto)
export const BACKUP_VERSION        = 2;
const MAX_IMPORT_TRIPS = 100_000;
const MAX_IMPORT_AUDIT = 500_000;
const tripId = z.number().int().min(1).max(MAX_INT);

// Protokolldaten feldweise prüfen – ungültige Werte würden später Auswertungen
// (Casts auf timestamptz/int in SQL) scheitern lassen; unbekannte Felder entfallen
const auditData = z.object({
  odometer_km: tripFields.odometer_km.optional(),
  destination: z.string().max(500).optional(),
  trip_type:   tripFields.trip_type.optional(),
  timestamp:   tripFields.timestamp.optional(),
  vehicle_id:  z.number().int().min(1).max(MAX_INT).nullable().optional(),
}, { error: "Ungültige Protokolldaten" }).nullable().optional().transform(v => v ?? null);

const importTrips = z.array(z.object({
  id:          tripId,
  odometer_km: tripFields.odometer_km,
  destination: tripFields.destination,
  trip_type:   tripFields.trip_type,
  timestamp:   tripFields.timestamp,
}), { error: "Ungültige Fahrtenliste" }).max(MAX_IMPORT_TRIPS, { error: `Höchstens ${MAX_IMPORT_TRIPS} Fahrten pro Fahrzeug` });

const importAudit = z.array(z.object({
  trip_id:    tripId,
  action:     z.enum(["create", "update", "delete"]),
  old_data:   auditData,
  new_data:   auditData,
  source:     z.string().max(20).optional().default("web"),
  changed_at: tripFields.timestamp,
}), { error: "Ungültiges Änderungsprotokoll" })
  .max(MAX_IMPORT_AUDIT, { error: `Höchstens ${MAX_IMPORT_AUDIT} Protokolleinträge pro Fahrzeug` })
  .optional().default([]);

// Alle Daten eines Fahrzeugs (Teil beider Formate)
const vehicleData = z.object({
  vehicle: z.object({
    id:            z.number().int().min(1).max(MAX_INT).nullable().optional().catch(null),
    name:          text("Fahrzeugname fehlt", 100),
    code:          z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/).nullable().optional().catch(null),
    license_plate: z.string().trim().max(20).nullable().optional().catch(null),
    list_price:    z.number().min(0).max(10_000_000).nullable().optional().catch(null),
    drive_type:    z.enum(DRIVE_TYPES).optional().catch("combustion"),
  }, { error: "Fahrzeugdaten fehlen" }),
  years: z.array(z.object({
    year:         z.number().int().min(1900).max(2999),
    total_costs:  z.number().min(0).max(10_000_000),
    depreciation: z.number().min(0).max(10_000_000).optional().default(0),
    commute_km:   z.number().min(0).max(1000).optional().default(0),
    months:       z.number().int().min(1).max(12).optional().default(12),
    tax_rate:     z.number().min(0).max(60).nullable().optional().default(null),
  }), { error: "Ungültige Jahreskosten" }).optional().default([]),
  trips: importTrips,
  audit: importAudit,
});

export const importBody = vehicleData.extend({
  format:  z.literal(VEHICLE_BACKUP_FORMAT, { error: "Keine Fahrzeug-Sicherung" }),
  version: z.literal(BACKUP_VERSION, { error: `Nicht unterstützte Version (erwartet ${BACKUP_VERSION})` }),
});

export const backupBody = z.object({
  format:     z.literal(BACKUP_FORMAT, { error: "Keine Gesamtsicherung" }),
  version:    z.literal(BACKUP_VERSION, { error: `Nicht unterstützte Version (erwartet ${BACKUP_VERSION})` }),
  vehicles:   z.array(vehicleData, { error: "Fahrzeuge fehlen" }),
  unassigned: z.object({ trips: importTrips, audit: importAudit })
    .optional().default({ trips: [], audit: [] }),
});

// ── Admin: Datenbank aufräumen ───────────────────────────────
const idListe = z.array(z.number().int().positive(), { error: "ids muss eine Liste von Fahrt-IDs sein" });

export const duplicatesBody = z.object({ ids: idListe.optional() });

export const unassignedBody = z.object({
  user_id:    z.number({ error: "user_id erforderlich" }).int().positive(),
  action:     z.enum(["assign", "delete"], { error: "action muss 'assign' oder 'delete' sein" }),
  vehicle_id: z.number().int().positive().optional(),
}).refine(d => d.action !== "assign" || d.vehicle_id, { error: "vehicle_id erforderlich zum Zuordnen" });

// DELETE /api/vehicles/:id?target=ID – Zielfahrzeug für vorhandene Fahrten
export const vehicleDeleteQuery = z.object({
  target: z.string().regex(/^\d{1,9}$/, { error: "Ungültiges Zielfahrzeug" }).transform(Number).optional(),
});
