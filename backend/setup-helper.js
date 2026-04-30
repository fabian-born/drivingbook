#!/usr/bin/env node
// ============================================================
// Fahrtenbuch – Setup-Hilfsskript
//
// Verwendung:
//   node setup-helper.js
//
// Gibt aus:
//   - bcrypt-Hash für ein eingegebenes Passwort
//   - Zufälligen JWT_SECRET
//   - SQL-Statement zum Setzen des Admin-Passworts
// ============================================================

import bcrypt   from "bcrypt";
import crypto   from "crypto";
import readline from "readline";

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
});

function frage(text) {
  return new Promise(resolve => rl.question(text, resolve));
}

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   Fahrtenbuch – Setup Hilfsskript        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ── JWT Secret ─────────────────────────────────────────
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  console.log("✅ Zufälliger JWT_SECRET (in .env eintragen):");
  console.log(`   JWT_SECRET=${jwtSecret}\n`);

  // ── Passwort hashen ────────────────────────────────────
  const passwort = await frage("🔑 Admin-Passwort eingeben (wird nicht angezeigt): ");

  if (passwort.length < 8) {
    console.error("❌ Passwort muss mindestens 8 Zeichen haben.");
    process.exit(1);
  }

  console.log("\n⏳ Hash wird generiert...");
  const hash = await bcrypt.hash(passwort, 12);

  console.log("\n✅ bcrypt-Hash:");
  console.log(`   ${hash}\n`);

  console.log("✅ SQL zum Setzen des Admin-Passworts:");
  console.log(`   UPDATE users SET password = '${hash}' WHERE username = 'admin';\n`);

  console.log("✅ Oder direkt in init.sql ersetzen:");
  console.log(`   Ersetze den Platzhalter-Hash mit:`);
  console.log(`   '${hash}'\n`);

  rl.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
