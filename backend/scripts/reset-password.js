#!/usr/bin/env node
// ============================================================
// Reset a user's password (e.g. a forgotten admin password)
//
//   node scripts/reset-password.js [username]     default: admin
//
// In a terminal the new password is prompted for hidden (leave empty =
// generate a random password). Without a terminal a random password
// is always generated and printed.
//
// In the container (prod):
//   docker exec -it drivingbook-backend node scripts/reset-password.js admin
//
// Database via DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
// (already set in the container).
// ============================================================

import bcrypt   from "bcrypt";
import crypto   from "crypto";
import pg       from "pg";
import readline from "readline";

const MIN_LENGTH = 8;
const MAX_LENGTH = 72;   // bcrypt processes at most 72 bytes

// Hidden input (typed characters are not echoed)
function askHidden(text) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(text)) rl.output.write(s); };
    rl.question(text, response => {
      rl.close();
      process.stdout.write("\n");
      resolve(response);
    });
  });
}

async function choosePassword() {
  if (process.stdin.isTTY) {
    const userInput = await askHidden(`Neues Passwort (leer = zufällig erzeugen): `);
    if (userInput) {
      if (userInput.length < MIN_LENGTH || userInput.length > MAX_LENGTH) {
        throw new Error(`Passwort muss ${MIN_LENGTH} bis ${MAX_LENGTH} Zeichen haben`);
      }
      if (await askHidden("Wiederholen: ") !== userInput) {
        throw new Error("Passwörter stimmen nicht überein");
      }
      return { password: userInput, generated: false };
    }
  }
  return { password: crypto.randomBytes(12).toString("base64url"), generated: true };
}

async function main() {
  // exactly as given, otherwise lower case (usernames are lower case since migration 005)
  const userInput = (process.argv[2] || "admin").trim();

  const pool = new pg.Pool({
    host:     process.env.DB_HOST     || "db",
    port:     Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || "fahrtenbuch",
    user:     process.env.DB_USER     || "fahrtenbuch",
    password: process.env.DB_PASSWORD || "fahrtenbuch",
  });

  try {
    const user = (await pool.query(
      `SELECT id, username, role FROM users WHERE username = $1 OR username = LOWER($1)
       ORDER BY (username = $1) DESC LIMIT 1`,
      [userInput]
    )).rows[0];
    const username = user?.username ?? userInput.toLowerCase();
    if (!user) {
      const admins = (await pool.query(`SELECT username FROM users WHERE role = 'admin' ORDER BY id`)).rows;
      console.error(`❌ Benutzer "${username}" nicht gefunden.`);
      console.error(`   Vorhandene Admins: ${admins.map(a => a.username).join(", ") || "keine"}`);
      process.exitCode = 1;
      return;
    }

    const { password: newPassword, generated } = await choosePassword();
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, user.id]);

    console.log(`✅ Passwort für "${username}" (${user.role}) wurde zurückgesetzt.`);
    if (generated) {
      console.log(`   Neues Passwort: ${newPassword}`);
      console.log("   Bitte nach dem Login unter Profil → Konto ändern.");
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
