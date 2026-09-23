// ============================================================
// Datenbank: Pool, Transaktionen, Migrationen
// ============================================================

import fs   from "fs";
import path from "path";
import pg   from "pg";
import { fileURLToPath } from "url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Beliebige feste Zahl: verhindert, dass zwei Backend-Instanzen gleichzeitig migrieren
const MIGRATION_LOCK_ID = 4711_2026;

export function createPool(dbConfig) {
  return new pg.Pool(dbConfig);
}

// Führt fn(client) in einer Transaktion aus
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Wartet, bis die Datenbank erreichbar ist (z. B. direkt nach Container-Start)
export async function waitForDatabase(pool, { attempts = 15, delayMs = 2000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`⏳ Datenbank nicht erreichbar (${err.message}) – neuer Versuch ${i + 1}/${attempts}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// Spielt alle noch nicht angewendeten SQL-Dateien aus migrations/ ein
// (alphabetisch sortiert, jede Datei in einer eigenen Transaktion)
export async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name       TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );

    const applied = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map(r => r.name)
    );
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`🗄️  Migration angewendet: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} fehlgeschlagen: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
