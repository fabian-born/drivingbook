// ============================================================
// Input schemas (zod)
// Unknown fields are dropped, strings are trimmed.
// ============================================================

import { z } from "zod";

export const TRIP_TYPES  = ["business", "private", "commute"];
const MAX_INT            = 2147483647;  // Upper bound of PostgreSQL INTEGER

// Number or purely numeric string (forms send strings)
const numeric = schema => z.preprocess(
  v => (typeof v === "string" && /^\s*\d+\s*$/.test(v)) ? Number(v) : v,
  schema
);

const text = (msg, max) =>
  z.string({ error: msg }).trim().min(1, { error: msg }).max(max, { error: "errors.maxChars" });

// ── Parameters ───────────────────────────────────────────────
export const idParam = z.object({
  id: z.string().regex(/^\d{1,9}$/, { error: "errors.invalidId" }).transform(Number),
});

export const yearParam = z.object({
  year: z.string().regex(/^\d{4}$/, { error: "errors.invalidYear" }).transform(Number),
});

// ?vehicle=CODE limits queries to one vehicle; if omitted: all vehicles
const vehicleFilter = z.string().trim().toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, { error: "errors.invalidVehicleCode" }).optional();

export const vehicleQuery = z.object({ vehicle: vehicleFilter });

export const monthQuery = z.object({
  month: z.string({ error: "errors.monthRequired" })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "errors.monthRequired" }),
  vehicle: vehicleFilter,
});

export const yearQuery = z.object({
  year: z.string({ error: "errors.yearRequired" })
    .regex(/^\d{4}$/, { error: "errors.yearRequired" }).transform(Number),
  vehicle: vehicleFilter,
});

export const auditQuery = z.object({
  year: z.string().regex(/^\d{4}$/, { error: "errors.yearRequired" }).transform(Number),
  vehicle: vehicleFilter,
});

// ── Trips ────────────────────────────────────────────────────
const KM_MSG = "errors.invalidOdometer";
const TS_MSG = "errors.invalidTimestamp";

const timestampField = z.union([z.string(), z.number()], { error: TS_MSG }).transform((v, ctx) => {
  const d = new Date(v);
  if (isNaN(d)) {
    ctx.issues.push({ code: "custom", message: TS_MSG, input: v });
    return z.NEVER;
  }
  return d.toISOString();
});
const odometerKm = numeric(
  z.number({ error: KM_MSG }).int({ error: KM_MSG }).min(0, { error: KM_MSG }).max(MAX_INT, { error: KM_MSG })
);

export const tripFields = {
  odometer_km: odometerKm,
  destination: text("errors.destinationRequired", 500),
  trip_type:   z.enum(TRIP_TYPES, { error: "errors.invalidTripType" }),
  timestamp:   timestampField,
};

// vehicle_code is always optional; null removes the assignment,
// if the field is missing entirely the default vehicle is used (on create only)
const vehicleCode = z.union(
  [z.null(), z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, { error: "errors.invalidVehicleCode" })],
  { error: "errors.invalidVehicleCode" }
).optional();

// force: true saves despite a warning from the odometer plausibility check
const force = z.boolean({ error: "errors.invalidForce" }).optional();

export const tripCreate = z.object({ ...tripFields, vehicle_code: vehicleCode, force });
export const tripUpdate = z.object({ ...tripFields, vehicle_code: vehicleCode, force }).partial();


// ── Auth & users ─────────────────────────────────────────────
const PASSWORD_MSG = "errors.passwordTooShort";
// bcrypt processes at most 72 bytes; longer input is pointless
const password = z.string({ error: PASSWORD_MSG }).min(8, { error: PASSWORD_MSG })
  .max(72, { error: "errors.passwordTooLong" });
// Usernames are always stored and compared in lower case
const username = text("errors.credentialsRequired", 100).toLowerCase();

export const loginBody = z.object({
  username: z.string({ error: "errors.credentialsRequired" }).trim().toLowerCase()
    .min(1, { error: "errors.credentialsRequired" }),
  password: z.string({ error: "errors.credentialsRequired" }).min(1, { error: "errors.credentialsRequired" }),
});

export const registerBody = z.object({
  username,
  password,
  vehicleName:  z.string().trim().max(100).optional(),
  vehicle_name: z.string().trim().max(100).optional(),   // older API clients
}).transform(({ vehicleName, vehicle_name, ...rest }) => ({
  ...rest,
  vehicleName: vehicleName || vehicle_name || null,   // null → translated default name
}));

export const createUserBody = z.object({
  username,
  password,
  // Unknown roles become "user", as before
  role: z.unknown().optional().transform(r => (r === "admin" ? "admin" : "user")),
});

export const changePasswordBody = z.object({
  currentPassword: z.string({ error: "errors.passwordsRequired" }).min(1, { error: "errors.passwordsRequired" }),
  newPassword: z.string({ error: "errors.passwordsRequired" })
    .min(8, { error: "errors.newPasswordTooShort" })
    .max(72, { error: "errors.passwordTooLong" }),
});

// ── Vehicles & tokens ────────────────────────────────────────
export const vehicleBody = z.object({
  name: text("errors.nameRequired", 100),
  is_default: z.unknown().optional().transform(v => v === true),
});

export const tokenBody = z.object({
  label: z.string().trim().max(100, { error: "errors.maxChars" }).optional()
    .transform(l => l || "API Token"),
  is_default: z.unknown().optional().transform(v => v === true),
});

// ── Country ──────────────────────────────────────────────
// Countries whose tax rules the tax comparison implements (ISO 3166-1 alpha-2)
export const TAX_COUNTRIES = ["DE"];

// ── Language ─────────────────────────────────────────────────
// UI languages (ISO 639-1); null = automatic (browser language)
export const LANGUAGES = ["de", "en"];

export const profileUpdateBody = z.object({
  language: z.enum(LANGUAGES, { error: "errors.invalidLanguage" }).nullable(),
});

// ── Auto-Info ────────────────────────────────────────────────
export const DRIVE_TYPES = ["combustion", "hybrid", "electric", "electric_high_price"];

// Decimal number; forms send strings, possibly with a comma ("1.234,56" or "1234,56").
// Empty string → null
const decimal = (msg, max) => z.preprocess(
  v => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    if (s === "") return null;
    // "1.234,56" / "1234,56" (German), "45.000" (thousands dot without comma), "1234.5"
    const normalized = s.includes(",")
      ? s.replace(/\./g, "").replace(",", ".")
      : (/^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
    return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : v;
  },
  z.number({ error: msg }).min(0, { error: msg }).max(max, { error: msg }).nullable()
);

export const vehicleUpdateBody = z.object({
  name:          text("errors.nameRequired", 100).optional(),
  license_plate: z.string({ error: "errors.invalidLicensePlate" }).trim().toUpperCase()
    .max(20, { error: "errors.maxChars" }).nullable().optional()
    .transform(v => (v === "" ? null : v)),
  list_price:    decimal("errors.invalidListPrice", 10_000_000).optional(),
  drive_type:    z.enum(DRIVE_TYPES, { error: "errors.invalidDriveType" }).optional(),
});

export const vehicleYearParam = z.object({
  id:   z.string().regex(/^\d{1,9}$/, { error: "errors.invalidId" }).transform(Number),
  year: z.string().regex(/^\d{4}$/, { error: "errors.invalidYear" }).transform(Number),
});

export const infoQuery = z.object({
  year: z.string().regex(/^\d{4}$/, { error: "errors.invalidYear" }).transform(Number).optional(),
});

export const vehicleYearBody = z.object({
  total_costs:  decimal("errors.invalidTotalCosts", 10_000_000)
    .refine(v => v != null, { error: "errors.totalCostsRequired" }),
  depreciation: decimal("errors.invalidDepreciation", 10_000_000).optional()
    .transform(v => v ?? 0),
  commute_km:   decimal("errors.invalidCommuteKm", 1000).optional()
    .transform(v => v ?? 0),
  months:       numeric(z.number({ error: "errors.invalidMonths" }).int()
    .min(1, { error: "errors.invalidMonths" }).max(12, { error: "errors.invalidMonths" }))
    .optional().transform(v => v ?? 12),
  tax_rate:     decimal("errors.invalidTaxRate", 60).optional()
    .transform(v => v ?? null),
}).refine(d => d.depreciation <= d.total_costs, { error: "errors.depreciationTooHigh" });

// ── Backup: single vehicle or whole account ─────────────────
// Format v2 (English). Convert files in format v1 (German, until 09/2026)
// with scripts/convert-backup.js first.
export const VEHICLE_BACKUP_FORMAT = "drivingbook-vehicle";   // single backup (car info)
export const BACKUP_FORMAT         = "drivingbook-backup";    // full backup (account)
export const BACKUP_VERSION        = 2;
const MAX_IMPORT_TRIPS = 100_000;
const MAX_IMPORT_AUDIT = 500_000;
const tripId = z.number().int().min(1).max(MAX_INT);

// Check audit log data field by field – invalid values would later break reports
// (casts to timestamptz/int in SQL); unknown fields are dropped
const auditData = z.object({
  odometer_km: tripFields.odometer_km.optional(),
  destination: z.string().max(500).optional(),
  trip_type:   tripFields.trip_type.optional(),
  timestamp:   tripFields.timestamp.optional(),
  vehicle_id:  z.number().int().min(1).max(MAX_INT).nullable().optional(),
}, { error: "errors.invalidAuditData" }).nullable().optional().transform(v => v ?? null);

const importTrips = z.array(z.object({
  id:          tripId,
  odometer_km: tripFields.odometer_km,
  destination: tripFields.destination,
  trip_type:   tripFields.trip_type,
  timestamp:   tripFields.timestamp,
}), { error: "errors.invalidTripList" }).max(MAX_IMPORT_TRIPS, { error: "errors.tooManyTrips" });

const importAudit = z.array(z.object({
  trip_id:    tripId,
  action:     z.enum(["create", "update", "delete"]),
  old_data:   auditData,
  new_data:   auditData,
  source:     z.string().max(20).optional().default("web"),
  changed_at: tripFields.timestamp,
}), { error: "errors.invalidAuditLog" })
  .max(MAX_IMPORT_AUDIT, { error: "errors.tooManyAuditEntries" })
  .optional().default([]);

// All data of one vehicle (part of both formats)
const vehicleData = z.object({
  vehicle: z.object({
    id:            z.number().int().min(1).max(MAX_INT).nullable().optional().catch(null),
    name:          text("errors.vehicleNameMissing", 100),
    code:          z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/).nullable().optional().catch(null),
    license_plate: z.string().trim().max(20).nullable().optional().catch(null),
    list_price:    z.number().min(0).max(10_000_000).nullable().optional().catch(null),
    drive_type:    z.enum(DRIVE_TYPES).optional().catch("combustion"),
  }, { error: "errors.vehicleDataMissing" }),
  years: z.array(z.object({
    year:         z.number().int().min(1900).max(2999),
    total_costs:  z.number().min(0).max(10_000_000),
    depreciation: z.number().min(0).max(10_000_000).optional().default(0),
    commute_km:   z.number().min(0).max(1000).optional().default(0),
    months:       z.number().int().min(1).max(12).optional().default(12),
    tax_rate:     z.number().min(0).max(60).nullable().optional().default(null),
  }), { error: "errors.invalidYearCosts" }).optional().default([]),
  trips: importTrips,
  audit: importAudit,
});

export const importBody = vehicleData.extend({
  format:  z.literal(VEHICLE_BACKUP_FORMAT, { error: "errors.notVehicleBackup" }),
  version: z.literal(BACKUP_VERSION, { error: "errors.unsupportedVersion" }),
});

export const backupBody = z.object({
  format:     z.literal(BACKUP_FORMAT, { error: "errors.notFullBackup" }),
  version:    z.literal(BACKUP_VERSION, { error: "errors.unsupportedVersion" }),
  vehicles:   z.array(vehicleData, { error: "errors.vehiclesMissing" }),
  unassigned: z.object({ trips: importTrips, audit: importAudit })
    .optional().default({ trips: [], audit: [] }),
});

// ── Admin: database cleanup ──────────────────────────────────
const idList = z.array(z.number().int().positive(), { error: "errors.invalidIds" });

export const duplicatesBody = z.object({ ids: idList.optional() });

export const unassignedBody = z.object({
  user_id:    z.number({ error: "errors.userIdRequired" }).int().positive(),
  action:     z.enum(["assign", "delete"], { error: "errors.invalidAction" }),
  vehicle_id: z.number().int().positive().optional(),
}).refine(d => d.action !== "assign" || d.vehicle_id, { error: "errors.vehicleIdRequired" });

// DELETE /api/vehicles/:id?target=ID – target vehicle for existing trips
export const vehicleDeleteQuery = z.object({
  target: z.string().regex(/^\d{1,9}$/, { error: "errors.invalidTarget" }).transform(Number).optional(),
});
