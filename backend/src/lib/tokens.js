// ============================================================
// API tokens
// Only the SHA-256 hash is stored in the DB; the plaintext
// is returned exactly once, on creation.
// ============================================================

import crypto from "crypto";

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// db: pool or client (for transactions)
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
