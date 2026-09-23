// ============================================================
// Startwerte
// - Leere DB: Admin mit ADMIN_PASSWORD (oder Zufallspasswort) anlegen
// - Warnen, falls der Admin noch das Passwort "admin" hat
// ============================================================

import bcrypt from "bcrypt";
import crypto from "crypto";
import { withTransaction } from "./db.js";
import { createApiToken } from "./lib/tokens.js";

export async function ensureAdmin(pool, adminConfig) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM users`);

  if (rows[0].count === 0) {
    const username = adminConfig.username;
    const password = adminConfig.password || crypto.randomBytes(12).toString("base64url");
    const hash     = await bcrypt.hash(password, 12);

    await withTransaction(pool, async client => {
      const userId = (await client.query(
        `INSERT INTO users (username, password, role) VALUES ($1, $2, 'admin') RETURNING id`,
        [username, hash]
      )).rows[0].id;
      await createApiToken(client, userId, "Default", true);
      await client.query(`INSERT INTO vehicles (user_id, name) VALUES ($1, 'Fahrzeug 1')`, [userId]);
    });

    console.log(`👤 Admin-User "${username}" angelegt.`);
    if (!adminConfig.password) {
      console.log(`   Generiertes Passwort: ${password}`);
      console.log("   Bitte nach dem ersten Login ändern – es wird nicht erneut angezeigt.");
    }
  }

  const admin = await pool.query(`SELECT password FROM users WHERE username = 'admin'`);
  if (admin.rows.length && await bcrypt.compare("admin", admin.rows[0].password)) {
    console.warn("⚠️  Der User \"admin\" hat noch das Standardpasswort \"admin\" – bitte sofort ändern!");
  }
}
