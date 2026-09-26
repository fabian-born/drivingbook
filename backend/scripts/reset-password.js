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

const MIN_LAENGE = 8;
const MAX_LAENGE = 72;   // bcrypt processes at most 72 bytes

// Hidden input (typed characters are not echoed)
function frageVerdeckt(text) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(text)) rl.output.write(s); };
    rl.question(text, antwort => {
      rl.close();
      process.stdout.write("\n");
      resolve(antwort);
    });
  });
}

async function neuesPasswort() {
  if (process.stdin.isTTY) {
    const eingabe = await frageVerdeckt(`Neues Passwort (leer = zufällig erzeugen): `);
    if (eingabe) {
      if (eingabe.length < MIN_LAENGE || eingabe.length > MAX_LAENGE) {
        throw new Error(`Passwort muss ${MIN_LAENGE} bis ${MAX_LAENGE} Zeichen haben`);
      }
      if (await frageVerdeckt("Wiederholen: ") !== eingabe) {
        throw new Error("Passwörter stimmen nicht überein");
      }
      return { passwort: eingabe, erzeugt: false };
    }
  }
  return { passwort: crypto.randomBytes(12).toString("base64url"), erzeugt: true };
}

async function main() {
  // exactly as given, otherwise lower case (usernames are lower case since migration 005)
  const eingabe = (process.argv[2] || "admin").trim();

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
      [eingabe]
    )).rows[0];
    const username = user?.username ?? eingabe.toLowerCase();
    if (!user) {
      const admins = (await pool.query(`SELECT username FROM users WHERE role = 'admin' ORDER BY id`)).rows;
      console.error(`❌ Benutzer "${username}" nicht gefunden.`);
      console.error(`   Vorhandene Admins: ${admins.map(a => a.username).join(", ") || "keine"}`);
      process.exitCode = 1;
      return;
    }

    const { passwort, erzeugt } = await neuesPasswort();
    const hash = await bcrypt.hash(passwort, 12);
    await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, user.id]);

    console.log(`✅ Passwort für "${username}" (${user.role}) wurde zurückgesetzt.`);
    if (erzeugt) {
      console.log(`   Neues Passwort: ${passwort}`);
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
