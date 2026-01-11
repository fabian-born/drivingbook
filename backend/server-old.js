import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// __dirname für ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());

// CORS aktivieren (erlaubt alle Domains, für Docker-Setup praktisch)
app.use(cors());

// Speicherordner
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// ------------------------
// POST: Neue Fahrt speichern
// ------------------------
// ------------------------
// POST: Neue Fahrt speichern (Import-kompatibel, JSON-only)
// ------------------------
app.post("/api/fahrt", (req, res) => {
  console.log("📥 Neue Fahrt empfangen:", req.body); // Debug-Log
  const { kmstand, ziel, fahrtart, timestamp } = req.body;

  if (!kmstand || !ziel || !fahrtart || !timestamp) {
    return res.status(400).json({ error: "Alle Felder erforderlich" });
  }

  // Timestamp in Date-Objekt umwandeln
  const date = new Date(timestamp);
  if (isNaN(date)) return res.status(400).json({ error: "Ungültiger Timestamp" });

  // Jahr und Monat aus dem Timestamp bestimmen
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const jsonFile = path.join(dataDir, `fahrten_${monthKey}.json`);

  // JSON speichern
  let fahrten = [];
  if (fs.existsSync(jsonFile)) {
    try {
      fahrten = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
    } catch (err) {
      console.error("Fehler beim Lesen der JSON-Datei:", err);
      fahrten = [];
    }
  }

  fahrten.push({ kmstand, ziel, fahrtart, timestamp });

  try {
    fs.writeFileSync(jsonFile, JSON.stringify(fahrten, null, 2));
    console.log(`✅ Fahrt gespeichert in ${jsonFile}`);
    res.json({ message: "Fahrt gespeichert", file: `fahrten_${monthKey}.json` });
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
    res.status(500).json({ error: "Fehler beim Speichern der JSON-Datei" });
  }
});


// ------------------------
// GET: CSV exportieren
// ------------------------
app.get("/api/export/csv", (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: "Query-Parameter 'month' erforderlich (YYYY-MM)" });

  const csvFile = path.join(dataDir, `fahrten_${month}.csv`);
  if (!fs.existsSync(csvFile)) return res.status(404).json({ error: "CSV-Datei für diesen Monat nicht gefunden" });

  res.download(csvFile, `fahrten_${month}.csv`);
});

// ------------------------
// GET: JSON exportieren
// ------------------------
app.get("/api/export/json", (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: "Query-Parameter 'month' erforderlich (YYYY-MM)" });

  const jsonFile = path.join(dataDir, `fahrten_${month}.json`);
  if (!fs.existsSync(jsonFile)) return res.status(404).json({ error: "JSON-Datei für diesen Monat nicht gefunden" });

  res.download(jsonFile, `fahrten_${month}.json`);
});


// Fahrt aktualisieren
app.put("/api/fahrt/:month/:index", (req, res) => {
  const { month, index } = req.params;
  const jsonFile = path.join(dataDir, `fahrten_${month}.json`);
  if (!fs.existsSync(jsonFile)) return res.status(404).json({ error: "Datei nicht gefunden" });

  let fahrten = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
  if (!fahrten[index]) return res.status(404).json({ error: "Eintrag nicht gefunden" });

  fahrten[index] = req.body;
  fs.writeFileSync(jsonFile, JSON.stringify(fahrten, null, 2));
  res.json({ message: "Fahrt aktualisiert" });
});

// Fahrt löschen
app.delete("/api/fahrt/:month/:index", (req, res) => {
  const { month, index } = req.params;
  const jsonFile = path.join(dataDir, `fahrten_${month}.json`);
  if (!fs.existsSync(jsonFile)) return res.status(404).json({ error: "Datei nicht gefunden" });

  let fahrten = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
  if (!fahrten[index]) return res.status(404).json({ error: "Eintrag nicht gefunden" });

  fahrten.splice(index, 1);
  fs.writeFileSync(jsonFile, JSON.stringify(fahrten, null, 2));
  res.json({ message: "Fahrt gelöscht" });
});


// ------------------------
// Server starten
// ------------------------
app.listen(PORT, () => console.log(`🚀 Backend läuft auf http://localhost:${PORT}`));
