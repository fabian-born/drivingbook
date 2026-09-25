// ============================================================
// Eingabe-Schemas (zod)
// Unbekannte Felder werden verworfen, Strings getrimmt.
// ============================================================

import { z } from "zod";

export const FAHRTARTEN  = ["privat", "geschäftlich", "arbeitsweg"];
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
const KM_MSG = "kmstand muss eine ganze Zahl ≥ 0 sein";
const TS_MSG = "Ungültiger Timestamp";

export const fahrtFields = {
  kmstand: numeric(
    z.number({ error: KM_MSG }).int({ error: KM_MSG }).min(0, { error: KM_MSG }).max(MAX_INT, { error: KM_MSG })
  ),
  ziel: text("ziel darf nicht leer sein", 500),
  fahrtart: z.enum(FAHRTARTEN, { error: `fahrtart muss einer der Werte sein: ${FAHRTARTEN.join(", ")}` }),
  timestamp: z.union([z.string(), z.number()], { error: TS_MSG }).transform((v, ctx) => {
    const d = new Date(v);
    if (isNaN(d)) {
      ctx.issues.push({ code: "custom", message: TS_MSG, input: v });
      return z.NEVER;
    }
    return d.toISOString();
  }),
};

// vehicle_code ist immer optional; null entfernt die Zuordnung,
// fehlt das Feld komplett wird das Default-Fahrzeug verwendet (nur beim Anlegen)
const vehicleCode = z.union(
  [z.null(), z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, { error: "Ungültiger Fahrzeug-Code" })],
  { error: "Ungültiger Fahrzeug-Code" }
).optional();

// force: true speichert trotz Warnung der km-Plausibilitätsprüfung
const force = z.boolean({ error: "force muss true oder false sein" }).optional();

export const fahrtCreate = z.object({ ...fahrtFields, vehicle_code: vehicleCode, force });
export const fahrtUpdate = z.object({ ...fahrtFields, vehicle_code: vehicleCode, force }).partial();

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
export const DRIVE_TYPES = ["verbrenner", "hybrid", "elektro", "elektro_teuer"];

// Dezimalzahl; Formulare senden Strings, ggf. mit Komma ("1.234,56" oder "1234,56").
// Leerer String → null
const decimal = (msg, max) => z.preprocess(
  v => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    if (s === "") return null;
    const normalisiert = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
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

// ── Export / Import eines Fahrzeugs ─────────────────────────
export const EXPORT_FORMAT  = "drivingbook-fahrzeug";
export const EXPORT_VERSION = 1;
const MAX_IMPORT_FAHRTEN    = 100_000;

const auditDaten = z.record(z.string(), z.unknown()).nullable().optional().transform(v => v ?? null);

export const importQuery = z.object({ vehicle: vehicleFilter });

export const importBody = z.object({
  format:  z.literal(EXPORT_FORMAT, { error: "Keine Fahrtenbuch-Exportdatei" }),
  version: z.literal(EXPORT_VERSION, { error: `Nicht unterstützte Version (erwartet ${EXPORT_VERSION})` }),
  fahrzeug: z.object({
    id:            z.number().int().nullable().optional(),
    name:          text("Fahrzeugname fehlt", 100),
    code:          z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/).nullable().optional().catch(null),
    license_plate: z.string().trim().max(20).nullable().optional().catch(null),
    list_price:    z.number().min(0).max(10_000_000).nullable().optional().catch(null),
    drive_type:    z.enum(DRIVE_TYPES).optional().catch("verbrenner"),
  }, { error: "Fahrzeugdaten fehlen" }),
  jahre: z.array(z.object({
    year:         z.number().int().min(1900).max(2999),
    total_costs:  z.number().min(0).max(10_000_000),
    depreciation: z.number().min(0).max(10_000_000).optional().default(0),
    commute_km:   z.number().min(0).max(1000).optional().default(0),
    months:       z.number().int().min(1).max(12).optional().default(12),
    tax_rate:     z.number().min(0).max(60).nullable().optional().default(null),
  }), { error: "Ungültige Jahreskosten" }).optional().default([]),
  fahrten: z.array(z.object({
    id:        z.number().int(),
    kmstand:   fahrtFields.kmstand,
    ziel:      fahrtFields.ziel,
    fahrtart:  fahrtFields.fahrtart,
    timestamp: fahrtFields.timestamp,
  }), { error: "Ungültige Fahrtenliste" }).max(MAX_IMPORT_FAHRTEN, { error: `Höchstens ${MAX_IMPORT_FAHRTEN} Fahrten pro Import` }),
  protokoll: z.array(z.object({
    fahrt_id:   z.number().int(),
    action:     z.enum(["create", "update", "delete"]),
    old_data:   auditDaten,
    new_data:   auditDaten,
    source:     z.string().max(20).optional().default("web"),
    changed_at: fahrtFields.timestamp,
  }), { error: "Ungültiges Änderungsprotokoll" }).optional().default([]),
});
