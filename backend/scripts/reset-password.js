#!/usr/bin/env node
// ============================================================
// Passwort eines Benutzers zurücksetzen (z. B. vergessenes Admin-Passwort)
//
//   node scripts/reset-password.js [benutzername]     Standard: admin
//
// Im Terminal wird das neue Passwort verdeckt abgefragt (leer lassen =
// zufälliges Passwort erzeugen). Ohne Terminal wird immer ein zufälliges
// Passwort erzeugt und ausgegeben.
//
// Im Container (Prod):
//   docker exec -it drivingbook-backend node scripts/reset-password.js admin
//
// Datenbank über DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
// (im Container bereits gesetzt).
// ============================================================

import bcrypt   from "bcrypt";
import crypto   from "crypto";
import pg       from "pg";
import readline from "readline";

const MIN_LAENGE = 8;
const MAX_LAENGE = 72;   // bcrypt verarbeitet höchstens 72 Byte

// Verdeckte Eingabe (keine Ausgabe der getippten Zeichen)
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
  // exakt wie angegeben, sonst klein geschrieben (Benutzernamen sind seit Migration 005 klein)
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
