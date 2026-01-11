import fs from "fs";
import path from "path";
import fetch from "node-fetch";

// 🔹 Backend-URL anpassen:
// - Wenn Backend lokal läuft: http://localhost:3000
// - Wenn Test in Docker läuft: http://backend:3000
const API_BASE_URL = "http://192.168.4.249:3000";

// CSV-Datei, die importiert werden soll
const csvFile = path.join(process.cwd(), "fahrten.csv");

// Parser-Funktion wie im Frontend
function parseCsv(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l);
  const headers = lines[0].split(";").map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(";").map(v => v.trim());
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i] || "";
      return obj;
    }, {});
  });
}

// CSV importieren und an Backend senden
async function importCsv() {
  const text = fs.readFileSync(csvFile, "utf-8");
  const rows = parseCsv(text);

  if (!rows.length) {
    console.log("❌ Keine Daten in CSV gefunden!");
    return;
  }

  for (const row of rows) {
    const fahrt = {
      kmstand: row["KM Stand"] || "",
      ziel: row["Kundenname"] || "",
      fahrtart: row["drivetype"]?.toLowerCase() === "geschäftlich" ? "geschäftlich" : "privat",
      timestamp: row["Completion time"] || row["Start time"] || new Date().toISOString()
    };

    console.log("➡️ Importiere Fahrt:", fahrt);

    try {
      const res = await fetch(`${API_BASE_URL}/api/addFahrt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fahrt)
      });

      const text = await res.text();
      console.log("➡️ Antwort vom Server:", res.status, text);

      if (!res.ok) {
        throw new Error(`Fehler beim Import (${res.status})`);
      }
    } catch (err) {
      console.error("❌ Import-Fehler:", err);
    }
  }

  console.log("✅ CSV-Import abgeschlossen!");
}

// Prüfen, ob die JSON-Datei angelegt wurde
function checkJson() {
  const now = new Date();
  const fileName = `fahrten_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.json`;
  const filePath = path.join(process.cwd(), "data", fileName);

  if (!fs.existsSync(filePath)) {
    console.log("❌ Monatsdatei nicht gefunden:", filePath);
    return;
  }

  const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  console.log(`📂 Gefundene Fahrten in ${fileName}:`, content);
}

// Ablauf
(async () => {
  await importCsv();
  checkJson();
})();
