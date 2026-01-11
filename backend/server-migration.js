#!/usr/bin/env node

import fs from "fs";
import path from "path";
import pkg from "pg";
import { fileURLToPath } from "url";

const { Pool } = pkg;

// ------------------------
// PostgreSQL Verbindung
// ------------------------
const pool = new Pool({
  host: process.env.POSTGRES_HOST || "192.168.72.2",
  port: 5432,
  user: process.env.POSTGRES_USER || "pqadmin",
  password: process.env.POSTGRES_PASSWORD || "yaam48l4OSzJQ7",
  database: process.env.POSTGRES_DB || "fahrtenbuch",
});

// ------------------------
// __dirname für ESM
// ------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "data");

async function migrate() {
  console.log("🚀 Starte Migration der JSON-Dateien...");

  const files = fs.readdirSync(dataDir).filter(f => f.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(dataDir, file);
    let fahrten = [];

    try {
      fahrten = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
      console.error(`❌ Fehler beim Lesen von ${file}:`, err);
      continue;
    }

    for (const f of fahrten) {
      const { kmstand, ziel, fahrtart, timestamp } = f;

      if (!kmstand || !ziel || !fahrtart || !timestamp) {
        console.warn(`⚠ Ungültiger Eintrag in ${file}:`, f);
        continue;
      }

      try {
        // Duplikat vermeiden: prüfen, ob gleiche kmstand + timestamp existiert
        const existing = await pool.query(
          `SELECT id FROM fahrten WHERE kmstand=$1 AND timestamp=$2`,
          [kmstand, timestamp]
        );

        if (existing.rows.length > 0) {
          console.log(`ℹ Fahrt bereits vorhanden: km=${kmstand}, ts=${timestamp}`);
          continue;
        }

        // Einfügen
        await pool.query(
          `INSERT INTO fahrten (kmstand, ziel, fahrtart, timestamp)
           VALUES ($1, $2, $3, $4)`,
          [kmstand, ziel, fahrtart, timestamp]
        );

        console.log(`✅ Fahrt migriert: km=${kmstand}, ts=${timestamp}`);
      } catch (err) {
        console.error(`❌ Fehler beim Einfügen der Fahrt aus ${file}:`, err);
      }
    }
  }

  await pool.end();
  console.log("🎉 Migration abgeschlossen!");
}

migrate();

