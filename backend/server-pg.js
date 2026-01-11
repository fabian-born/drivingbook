import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3001;

// ------------------------
// PostgreSQL Verbindung
// ------------------------
const pool = new Pool({
  host: process.env.POSTGRES_HOST || "192.168.72.2",
  port: 5432,
  user: process.env.POSTGRES_USER || "pqfahrtenbuch",
  password: process.env.POSTGRES_PASSWORD || "hsG3ZLJYz1a181",
  database: process.env.POSTGRES_DB || "fahrtenbuch",
});

// ------------------------
// Middleware
// ------------------------
app.use(cors());
app.use(express.json());

// ------------------------
// POST: Neue Fahrt speichern
// ------------------------
app.post("/api/fahrt", async (req, res) => {
  const { kmstand, ziel, fahrtart, timestamp } = req.body;

  if (!kmstand || !ziel || !fahrtart || !timestamp) {
    return res.status(400).json({ error: "Alle Felder erforderlich" });
  }

  const date = new Date(timestamp);
  if (isNaN(date)) {
    return res.status(400).json({ error: "Ungültiger Timestamp" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO fahrten (kmstand, ziel, fahrtart, timestamp)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [kmstand, ziel, fahrtart, date]
    );

    res.json({ message: "Fahrt gespeichert", fahrt: result.rows[0] });
  } catch (err) {
    console.error("DB-Fehler:", err);
    res.status(500).json({ error: "Fehler beim Speichern" });
  }
});

// ------------------------
// GET: Fahrten eines Monats
// ------------------------
app.get("/api/fahrten", async (req, res) => {
  const { month } = req.query; // YYYY-MM

  if (!month) {
    return res.status(400).json({ error: "Query-Parameter 'month' erforderlich" });
  }

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM fahrten
      WHERE DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', $1::date)
      ORDER BY timestamp
      `,
      [`${month}-01`]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("DB-Fehler:", err);
    res.status(500).json({ error: "Fehler beim Laden der Fahrten" });
  }
});

// ------------------------
// PUT: Fahrt aktualisieren
// ------------------------
app.put("/api/fahrt/:id", async (req, res) => {
  const { id } = req.params;
  const { kmstand, ziel, fahrtart, timestamp } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE fahrten
      SET kmstand=$1, ziel=$2, fahrtart=$3, timestamp=$4
      WHERE id=$5
      RETURNING *
      `,
      [kmstand, ziel, fahrtart, timestamp, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Fahrt nicht gefunden" });
    }

    res.json({ message: "Fahrt aktualisiert", fahrt: result.rows[0] });
  } catch (err) {
    console.error("DB-Fehler:", err);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

// ------------------------
// DELETE: Fahrt löschen
// ------------------------
app.delete("/api/fahrt/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM fahrten WHERE id=$1 RETURNING id",
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Fahrt nicht gefunden" });
    }

    res.json({ message: "Fahrt gelöscht" });
  } catch (err) {
    console.error("DB-Fehler:", err);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ------------------------
// GET: CSV Export
// ------------------------
app.get("/api/export/csv", async (req, res) => {
  const { month } = req.query;

  if (!month) {
    return res.status(400).json({ error: "Query-Parameter 'month' erforderlich" });
  }

  try {
    const result = await pool.query(
      `
      SELECT kmstand, ziel, fahrtart, timestamp
      FROM fahrten
      WHERE DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', $1::date)
      ORDER BY timestamp
      `,
      [`${month}-01`]
    );

    let csv = "kmstand,ziel,fahrtart,timestamp\n";
    result.rows.forEach(r => {
      csv += `${r.kmstand},"${r.ziel}",${r.fahrtart},${r.timestamp.toISOString()}\n`;
    });

    res.header("Content-Type", "text/csv");
    res.attachment(`fahrten_${month}.csv`);
    res.send(csv);
  } catch (err) {
    console.error("CSV-Fehler:", err);
    res.status(500).json({ error: "CSV-Export fehlgeschlagen" });
  }
});

// ------------------------
// Server starten
// ------------------------
app.listen(PORT, () => {
  console.log(`🚀 Backend läuft auf http://localhost:${PORT}`);
});

