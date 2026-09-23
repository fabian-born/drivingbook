// ============================================================
// API-Tokens
// In der DB wird nur der SHA-256-Hash gespeichert; der Klartext
// wird genau einmal bei der Erstellung zurückgegeben.
// ============================================================

import crypto from "crypto";

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// db: Pool oder Client (für Transaktionen)
export async function createApiToken(db, userId, label, isDefault) {
  const token = crypto.randomBytes(32).toString("hex");
  const result = await db.query(
    `INSERT INTO api_tokens (user_id, token_hash, label, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, is_default, created_at`,
    [userId, hashToken(token), label, isDefault]
  );
  return { ...result.rows[0], token };
}
