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

// CORS aktivieren (erlaubt alle Domains)
app.use(cors());

// Speicherordner
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// ------------------------
// POST: Neue Fahrt speichern (Import-kompatibel, JSON-only)
// ------------------------
app.post("/api/fahrt", (req, res) => {
  console.log("📥 Neue Fahrt empfangen:", req.body);
  const { kmstand, ziel, fahrtart, timestamp } = req.body;

  if (!kmstand || !ziel || !fahrtart || !timestamp) {
    return res.status(400).json({ error: "Alle Felder erforderlich" });
  }

  const date = new Date(timestamp);
  if (isNaN(date)) return res.status(400).json({ error: "Ungültiger Timestamp" });

  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const jsonFile = path.join(dataDir, `fahrten_${monthKey}.json`);

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
// GET: JSON exportieren (Frontend Fetch)
// ------------------------
app.get("/api/export/json", (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: "Query-Parameter 'month' erforderlich (YYYY-MM)" });

  const jsonFile = path.join(dataDir, `fahrten_${month}.json`);
  if (!fs.existsSync(jsonFile)) return res.status(404).json({ error: "JSON-Datei für diesen Monat nicht gefunden" });

  // ❌ Nicht mehr download, sondern direkt JSON senden
  res.json(JSON.parse(fs.readFileSync(jsonFile, "utf-8")));
});

// ------------------------
// GET: CSV exportieren pro Monat (optional)
// ------------------------
app.get("/api/export/csv", (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: "Query-Parameter 'month' erforderlich (YYYY-MM)" });

  const csvFile = path.join(dataDir, `fahrten_${month}.csv`);
  if (!fs.existsSync(csvFile)) return res.status(404).json({ error: "CSV-Datei für diesen Monat nicht gefunden" });

  res.download(csvFile, `fahrten_${month}.csv`);
});

// ------------------------
// GET: CSV Export pro Jahr
// ------------------------
app.get("/api/export/csv/year/:year", (req, res) => {
  const year = req.params.year;
  let csv = "KM Stand;Ziel;Fahrtart;Zeitpunkt\n";

  fs.readdirSync(dataDir)
    .filter(f => f.startsWith(`fahrten_${year}-`) && f.endsWith(".json"))
    .sort()
    .forEach(file => {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file)));
      data.forEach(f => {
        csv += `${f.kmstand};"${f.ziel}";${f.fahrtart};${f.timestamp}\n`;
      });
    });

  res.header("Content-Type", "text/csv");
  res.attachment(`fahrten_${year}.csv`);
  res.send(csv);
});

// ------------------------
// PUT: Fahrt aktualisieren (Inline Editing)
// ------------------------
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

// ------------------------
// DELETE: Fahrt löschen
// ------------------------
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
