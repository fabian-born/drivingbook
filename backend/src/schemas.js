// ============================================================
// Eingabe-Schemas (zod)
// Unbekannte Felder werden verworfen, Strings getrimmt.
// ============================================================

import { z } from "zod";

export const FAHRTARTEN  = ["privat", "geschäftlich"];
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

export const auditQuery = z.object({
  year: z.string().regex(/^\d{4}$/, { error: "Query-Parameter 'year' erforderlich (YYYY)" }).transform(Number),
  vehicle: vehicleFilter,
});

// ── Fahrten ──────────────────────────────────────────────────
const KM_MSG = "kmstand muss eine ganze Zahl ≥ 0 sein";
const TS_MSG = "Ungültiger Timestamp";

const fahrtFields = {
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
