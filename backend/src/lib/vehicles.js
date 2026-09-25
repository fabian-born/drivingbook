// ============================================================
// Fahrzeuge
// Jedes Fahrzeug bekommt neben der internen ID einen 6-stelligen,
// eindeutigen Code (öffentliche Kennung für API-Aufrufe).
// ============================================================

import crypto from "crypto";

// Ohne 0/O/1/I zur besseren Lesbarkeit
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

// db: Pool oder Client (für Transaktionen)
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
      // 23505 = unique_violation → Code-Kollision, nochmal versuchen
      if (err.code === "23505" && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
}
