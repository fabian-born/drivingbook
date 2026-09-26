// ============================================================
// Vehicles
// Besides its internal ID, every vehicle gets a unique 6-character
// code (public identifier for API calls).
// ============================================================

import crypto from "crypto";
import { HttpError } from "../http.js";

// Without 0/O/1/I for better readability
const CODE_CHARS  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;

function randomCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  }
  return code;
}

// db: pool or client (for transactions)
export async function createVehicle(db, userId, name, isDefault) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await db.query(
        `INSERT INTO vehicles (user_id, name, code, is_default)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, code, is_default, created_at`,
        [userId, name, randomCode(), isDefault]
      );
      return result.rows[0];
    } catch (err) {
      // 23505 = unique_violation → code collision, try again
      if (err.code === "23505" && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
}

// Returns the internal ID of one of the user's vehicles by its code
// (undefined → null, i.e. no restriction). Foreign/unknown codes → 404.
export async function vehicleIdByCode(db, userId, code) {
  if (code === undefined) return null;
  const result = await db.query(
    `SELECT id FROM vehicles WHERE code = $1 AND user_id = $2`,
    [code, userId]
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, "Fahrzeug-Code nicht gefunden oder keine Berechtigung");
  }
  return result.rows[0].id;
}
