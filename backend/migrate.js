#!/usr/bin/env node
// ============================================================
// Logbook – migration script
// JSON files (legacy format) → PostgreSQL
//
// Usage:
//   node migrate.js --user <username> --dir <path-to-json-folder>
//
// Options:
//   --user     <username>  target user in the DB (must exist)
//   --dir      <path>      folder with fahrten_YYYY-MM.json files (default: ./data)
//   --vehicle  <id>        vehicle ID to assign (optional, otherwise auto)
//   --dry-run              preview only, write nothing
//   --host     <host>      DB host     (default: localhost)
//   --port     <port>      DB port     (default: 5432)
//   --db       <name>      DB name     (default: fahrtenbuch)
//   --dbuser   <user>      DB user     (default: fahrtenbuch)
//   --dbpass   <pass>      DB password
//
// Example (local):
//   node migrate.js --user admin --dir ./data --dbpass MyPassword
//
// Example (inside the Docker container):
//   docker cp ./data fahrtenbuch-backend:/app/data
//   docker exec -it fahrtenbuch-backend node migrate.js --user admin --dir ./data
// ============================================================

import pg       from "pg";
import fs       from "fs";
import path     from "path";
import readline from "readline";

const { Pool } = pg;

// ── Parse arguments ──────────────────────────────────────────
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

function ask(rl, text) {
  return new Promise(resolve => rl.question(text, resolve));
}

// Trip type of the legacy JSON files ("privat"/"geschäftlich") → database value
function parseTripType(raw) {
  if (!raw) return "private";
  return raw.toLowerCase().trim().includes("gesch") ? "business" : "private";
}

function parseTimestamp(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d) ? null : d.toISOString();
}

// ── Load JSON files ───────────────────────────────────────────
function loadJsonFiles(dir) {
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
  const all = [];
  for (const file of files) {
    try {
      const trips = JSON.parse(fs.readFileSync(path.join(absDir, file), "utf-8"));
      console.log(`   ✓ ${file}  (${trips.length} Einträge)`);
      all.push(...trips);
    } catch (err) {
      console.warn(`   ⚠️  ${file} Lesefehler: ${err.message}`);
    }
  }
  return all;
}

// ── Main ──────────────────────────────────────────────────────
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

  const trips = loadJsonFiles(opts.dir);
  console.log(`\n📊 Gesamt: ${trips.length} Fahrten\n`);

  if (trips.length === 0) { console.log("ℹ️  Keine Fahrten. Abbruch."); return; }

  // Preview
  console.log("Vorschau (erste 3 Einträge):");
  trips.slice(0, 3).forEach((f, i) =>
    console.log(`  [${i+1}] km=${f.kmstand}  ziel="${f.ziel}"  art=${f.fahrtart}  ts=${f.timestamp}`)
  );
  console.log();

  if (opts.dryRun) {
    console.log(`✅ Dry-Run: ${trips.length} Einträge würden importiert.`);
    return;
  }

  // Confirmation
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const response = await ask(rl,
    `⚠️  ${trips.length} Fahrten → User "${opts.user}" importieren? (ja/nein): `
  );
  rl.close();

  if (response.trim().toLowerCase() !== "ja") { console.log("❌ Abgebrochen."); return; }

  // DB connection
  const pool = new Pool({
    host: opts.host, port: opts.port,
    database: opts.db, user: opts.dbuser, password: opts.dbpass,
  });

  try {
    const client = await pool.connect();
    console.log("✅ DB-Verbindung OK\n");

    // Look up user ID
    const userRes = await client.query(`SELECT id FROM users WHERE username = $1`, [opts.user]);
    if (userRes.rows.length === 0) {
      console.error(`❌ User "${opts.user}" nicht gefunden. Bitte zuerst registrieren.`);
      client.release(); await pool.end(); process.exit(1);
    }
    const userId = userRes.rows[0].id;
    console.log(`👤 User "${opts.user}" (ID: ${userId})`);

    // Determine vehicle ID
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

    let succeeded = 0, errors = 0, duplicate = 0;

    for (const f of trips) {
      const ts      = parseTimestamp(f.timestamp);
      const kmstand = parseInt(f.kmstand, 10);

      if (!ts || isNaN(kmstand)) {
        console.warn(`  ⚠️  Übersprungen (ungültige Daten): ${JSON.stringify(f)}`);
        errors++;
        continue;
      }

      // Duplicate check
      const dup = await client.query(
        `SELECT id FROM trips WHERE user_id=$1 AND timestamp=$2 AND odometer_km=$3`,
        [userId, ts, kmstand]
      );
      if (dup.rows.length > 0) { duplicate++; continue; }

      try {
        await client.query(
          `INSERT INTO trips (user_id, vehicle_id, odometer_km, destination, trip_type, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, opts.vehicleId || null, kmstand,
           (f.ziel || "").trim() || "–", parseTripType(f.fahrtart), ts]
        );
        succeeded++;
      } catch (err) {
        console.error(`  ❌ ${err.message}`);
        errors++;
      }
    }

    await client.query("COMMIT");
    client.release();

    console.log("\n╔══════════════════════════════════╗");
    console.log("║     Migration abgeschlossen      ║");
    console.log("╠══════════════════════════════════╣");
    console.log(`║  ✅ Importiert : ${String(succeeded).padStart(6)}           ║`);
    console.log(`║  ↩️  Duplikate  : ${String(duplicate).padStart(6)}           ║`);
    console.log(`║  ❌ Fehler     : ${String(errors).padStart(6)}           ║`);
    console.log("╚══════════════════════════════════╝\n");

  } catch (err) {
    console.error("❌ DB-Fehler:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
