#!/usr/bin/env node
// ============================================================
// Fahrtenbuch – Migrationsskript
// JSON-Dateien (altes Format) → PostgreSQL
//
// Verwendung:
//   node migrate.js --user <username> --dir <pfad-zu-json-ordner>
//
// Optionen:
//   --user     <username>  Ziel-User in der DB (muss existieren)
//   --dir      <pfad>      Ordner mit fahrten_YYYY-MM.json Dateien (Standard: ./data)
//   --vehicle  <id>        Fahrzeug-ID zuweisen (optional, sonst auto)
//   --dry-run              Nur anzeigen, nichts schreiben
//   --host     <host>      DB-Host     (Standard: localhost)
//   --port     <port>      DB-Port     (Standard: 5432)
//   --db       <name>      DB-Name     (Standard: fahrtenbuch)
//   --dbuser   <user>      DB-User     (Standard: fahrtenbuch)
//   --dbpass   <pass>      DB-Passwort
//
// Beispiel (lokal):
//   node migrate.js --user admin --dir ./data --dbpass MeinPasswort
//
// Beispiel (im Docker-Container):
//   docker cp ./data fahrtenbuch-backend:/app/data
//   docker exec -it fahrtenbuch-backend node migrate.js --user admin --dir ./data
// ============================================================

import pg       from "pg";
import fs       from "fs";
import path     from "path";
import readline from "readline";
import { COL, TAB, fahrtartZuDb } from "./src/lib/dbschema.js";

const { Pool } = pg;

// ── Argumente parsen ─────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    user:      null,
    dir:       "./data",
    vehicleId: null,
    dryRun:    false,
    host:      process.env.DB_HOST     || "localhost",
    port:      parseInt(process.env.DB_PORT || "5432"),
    db:        process.env.DB_NAME     || "fahrtenbuch",
    dbuser:    process.env.DB_USER     || "fahrtenbuch",
    dbpass:    process.env.DB_PASSWORD || "",
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--user":    opts.user      = args[++i]?.toLowerCase(); break;
      case "--dir":     opts.dir       = args[++i];       break;
      case "--vehicle": opts.vehicleId = parseInt(args[++i]); break;
      case "--dry-run": opts.dryRun    = true;            break;
      case "--host":    opts.host      = args[++i];       break;
      case "--port":    opts.port      = parseInt(args[++i]); break;
      case "--db":      opts.db        = args[++i];       break;
      case "--dbuser":  opts.dbuser    = args[++i];       break;
      case "--dbpass":  opts.dbpass    = args[++i];       break;
    }
  }
  return opts;
}

function frage(rl, text) {
  return new Promise(resolve => rl.question(text, resolve));
}

function parseFahrtart(raw) {
  if (!raw) return "privat";
  return raw.toLowerCase().trim().includes("gesch") ? "geschäftlich" : "privat";
}

function parseTimestamp(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d) ? null : d.toISOString();
}

// ── JSON-Dateien laden ────────────────────────────────────────
function ladeJsonDateien(dir) {
  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    console.error(`❌ Verzeichnis nicht gefunden: ${absDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(absDir)
    .filter(f => f.match(/^fahrten_\d{4}-\d{2}\.json$/))
    .sort();

  if (files.length === 0) {
    console.error(`❌ Keine fahrten_YYYY-MM.json Dateien in: ${absDir}`);
    process.exit(1);
  }

  console.log(`📂 ${files.length} Datei(en) gefunden in ${absDir}:`);
  const alle = [];
  for (const file of files) {
    try {
      const fahrten = JSON.parse(fs.readFileSync(path.join(absDir, file), "utf-8"));
      console.log(`   ✓ ${file}  (${fahrten.length} Einträge)`);
      alle.push(...fahrten);
    } catch (err) {
      console.warn(`   ⚠️  ${file} Lesefehler: ${err.message}`);
    }
  }
  return alle;
}

// ── Hauptprogramm ─────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   Fahrtenbuch – JSON → PostgreSQL Migration  ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  if (!opts.user) {
    console.error("❌ --user ist Pflicht.\n   Beispiel: node migrate.js --user admin --dir ./data");
    process.exit(1);
  }

  if (opts.dryRun) console.log("🔍 DRY-RUN – es wird nichts geschrieben.\n");

  const fahrten = ladeJsonDateien(opts.dir);
  console.log(`\n📊 Gesamt: ${fahrten.length} Fahrten\n`);

  if (fahrten.length === 0) { console.log("ℹ️  Keine Fahrten. Abbruch."); return; }

  // Vorschau
  console.log("Vorschau (erste 3 Einträge):");
  fahrten.slice(0, 3).forEach((f, i) =>
    console.log(`  [${i+1}] km=${f.kmstand}  ziel="${f.ziel}"  art=${f.fahrtart}  ts=${f.timestamp}`)
  );
  console.log();

  if (opts.dryRun) {
    console.log(`✅ Dry-Run: ${fahrten.length} Einträge würden importiert.`);
    return;
  }

  // Bestätigung
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const antwort = await frage(rl,
    `⚠️  ${fahrten.length} Fahrten → User "${opts.user}" importieren? (ja/nein): `
  );
  rl.close();

  if (antwort.trim().toLowerCase() !== "ja") { console.log("❌ Abgebrochen."); return; }

  // DB-Verbindung
  const pool = new Pool({
    host: opts.host, port: opts.port,
    database: opts.db, user: opts.dbuser, password: opts.dbpass,
  });

  try {
    const client = await pool.connect();
    console.log("✅ DB-Verbindung OK\n");

    // User-ID ermitteln
    const userRes = await client.query(`SELECT id FROM users WHERE username = $1`, [opts.user]);
    if (userRes.rows.length === 0) {
      console.error(`❌ User "${opts.user}" nicht gefunden. Bitte zuerst registrieren.`);
      client.release(); await pool.end(); process.exit(1);
    }
    const userId = userRes.rows[0].id;
    console.log(`👤 User "${opts.user}" (ID: ${userId})`);

    // Fahrzeug-ID bestimmen
    if (opts.vehicleId) {
      const vCheck = await client.query(
        `SELECT id, name FROM vehicles WHERE id = $1 AND user_id = $2`,
        [opts.vehicleId, userId]
      );
      if (vCheck.rows.length === 0) {
        console.error(`❌ Fahrzeug ID ${opts.vehicleId} nicht gefunden oder falsche Berechtigung.`);
        client.release(); await pool.end(); process.exit(1);
      }
      console.log(`🚗 Fahrzeug: "${vCheck.rows[0].name}" (ID: ${opts.vehicleId})`);
    } else {
      const vDef = await client.query(
        `SELECT id, name FROM vehicles WHERE user_id = $1 ORDER BY id ASC LIMIT 1`,
        [userId]
      );
      if (vDef.rows.length > 0) {
        opts.vehicleId = vDef.rows[0].id;
        console.log(`🚗 Fahrzeug automatisch: "${vDef.rows[0].name}" (ID: ${opts.vehicleId})`);
      } else {
        console.log(`ℹ️  Kein Fahrzeug – vehicle_id wird NULL`);
      }
    }

    console.log("\n⏳ Import läuft …\n");
    await client.query("BEGIN");

    let erfolg = 0, fehler = 0, doppelt = 0;

    for (const f of fahrten) {
      const ts      = parseTimestamp(f.timestamp);
      const kmstand = parseInt(f.kmstand, 10);

      if (!ts || isNaN(kmstand)) {
        console.warn(`  ⚠️  Übersprungen (ungültige Daten): ${JSON.stringify(f)}`);
        fehler++;
        continue;
      }

      // Duplikat-Prüfung
      const dup = await client.query(
        `SELECT id FROM ${TAB.fahrten} WHERE user_id=$1 AND timestamp=$2 AND ${COL.kmstand}=$3`,
        [userId, ts, kmstand]
      );
      if (dup.rows.length > 0) { doppelt++; continue; }

      try {
        await client.query(
          `INSERT INTO ${TAB.fahrten} (user_id, vehicle_id, ${COL.kmstand}, ${COL.ziel}, ${COL.fahrtart}, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, opts.vehicleId || null, kmstand,
           (f.ziel || "").trim() || "–", fahrtartZuDb(parseFahrtart(f.fahrtart)), ts]
        );
        erfolg++;
      } catch (err) {
        console.error(`  ❌ ${err.message}`);
        fehler++;
      }
    }

    await client.query("COMMIT");
    client.release();

    console.log("\n╔══════════════════════════════════╗");
    console.log("║     Migration abgeschlossen      ║");
    console.log("╠══════════════════════════════════╣");
    console.log(`║  ✅ Importiert : ${String(erfolg).padStart(6)}           ║`);
    console.log(`║  ↩️  Duplikate  : ${String(doppelt).padStart(6)}           ║`);
    console.log(`║  ❌ Fehler     : ${String(fehler).padStart(6)}           ║`);
    console.log("╚══════════════════════════════════╝\n");

  } catch (err) {
    console.error("❌ DB-Fehler:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
