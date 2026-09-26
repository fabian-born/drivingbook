// ============================================================
// Initial data
// - Empty DB: create admin with ADMIN_PASSWORD (or a random password)
// - Warn if the admin still has the password "admin"
// ============================================================

import bcrypt from "bcrypt";
import crypto from "crypto";
import { withTransaction } from "./db.js";
import { createApiToken } from "./lib/tokens.js";
import { createVehicle } from "./lib/vehicles.js";

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
      await createVehicle(client, userId, "Fahrzeug 1", true);
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
