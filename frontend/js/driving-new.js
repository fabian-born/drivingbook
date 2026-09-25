// js/driving-new.js
// Neue Fahrt erfassen – auch offline: Fahrten ohne Verbindung werden
// lokal zwischengespeichert und automatisch nachgereicht.

const WARTESCHLANGE_KEY = "offlineFahrten";
const LETZTES_FAHRZEUG_KEY = "letztesFahrzeugCode";

// ── Fahrzeugauswahl ──────────────────────────────────────────
// Das Dropdown wird nur angezeigt, wenn der User mehr als ein Fahrzeug hat;
// bei genau einem Fahrzeug wird ohnehin automatisch das Standard-Fahrzeug verwendet.
async function ladeFahrzeuge() {
  const gruppe = document.getElementById("vehicleGroup");
  const select = document.getElementById("vehicleSelect");

  try {
    const res = await apiFetch("/api/vehicles");
    if (!res.ok) return;
    const vehicles = await res.json();
    if (vehicles.length <= 1) return;

    const letzterCode = localStorage.getItem(LETZTES_FAHRZEUG_KEY);
    const standard     = vehicles.find(v => v.code === letzterCode)
      ?? vehicles.find(v => v.is_default)
      ?? vehicles[0];

    select.innerHTML = vehicles.map(v =>
      `<option value="${v.code}" ${v.code === standard.code ? "selected" : ""}>${escapeHtml(v.name)}</option>`
    ).join("");
    gruppe.classList.remove("d-none");
  } catch { /* Fahrzeugliste optional – Formular bleibt ohne Auswahl nutzbar */ }
}

// ── Standort ─────────────────────────────────────────────────

function getLocation() {
  if (!navigator.geolocation) return zeigeStatus("Geolocation wird nicht unterstützt.", "warning");
  navigator.geolocation.getCurrentPosition(showPosition, showError);
}

async function showPosition(position) {
  const lat = position.coords.latitude.toFixed(6);
  const lon = position.coords.longitude.toFixed(6);
  const zielFeld = document.getElementById("ziel");

  // Offline: Koordinaten eintragen – das Backend löst sie beim Speichern in eine Adresse auf
  if (!navigator.onLine) {
    zielFeld.value = `${lat}, ${lon}`;
    return;
  }

  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`);
    const addr = (await res.json()).address || {};
    const strasse = [addr.road, addr.house_number].filter(Boolean).join(" ");
    const ort     = [addr.postcode, addr.city || addr.town || addr.village].filter(Boolean).join(" ");
    zielFeld.value = [strasse, ort].filter(Boolean).join(", ") || `${lat}, ${lon}`;
  } catch (err) {
    console.error("Location Error:", err);
    zielFeld.value = `${lat}, ${lon}`;
  }
}

function showError(error) {
  const msgs = ["Zugriff verweigert", "Position nicht verfügbar", "Zeitüberschreitung"];
  zeigeStatus(msgs[error.code - 1] || "Unbekannter Fehler", "warning");
}

// ── Statusanzeige ────────────────────────────────────────────

function zeigeStatus(text, typ = "success") {
  const box = document.getElementById("statusMeldung");
  box.className   = `alert alert-${typ}`;
  box.textContent = text;
}

// ── Offline-Warteschlange ────────────────────────────────────

function ladeWarteschlange() {
  try {
    return JSON.parse(localStorage.getItem(WARTESCHLANGE_KEY)) || [];
  } catch {
    return [];
  }
}

function speichereWarteschlange(liste) {
  localStorage.setItem(WARTESCHLANGE_KEY, JSON.stringify(liste));
  aktualisiereOfflineHinweis();
}

function aktualisiereOfflineHinweis() {
  const anzahl = ladeWarteschlange().length;
  const box    = document.getElementById("offlineHinweis");
  box.classList.toggle("d-none", anzahl === 0);
  document.getElementById("offlineAnzahl").textContent =
    anzahl === 1 ? "1 Fahrt wartet" : `${anzahl} Fahrten warten`;
}

// Sendet eine Fahrt; fragt bei unplausiblem km-Stand nach.
// Ergebnis: "ok" | "abgelehnt" (Nutzer hat abgebrochen) | "fehler" (Validierung o. ä.)
// Netzwerkfehler werden als Exception weitergereicht.
async function sendeFahrt(fahrt, hinweis = "") {
  let res = await apiFetch("/api/fahrt", { method: "POST", body: fahrt });

  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    if (err.code !== "KM_PLAUSIBILITY") return { status: "fehler", meldung: err.error };
    if (!confirm(`${hinweis}${err.error}\n\nTrotzdem speichern?`)) return { status: "abgelehnt" };
    res = await apiFetch("/api/fahrt", { method: "POST", body: { ...fahrt, force: true } });
  }

  if (!res.ok) return { status: "fehler", meldung: await apiError(res, "Fehler beim Speichern") };
  return { status: "ok" };
}

let syncLaeuft = false;

// Reicht offline erfasste Fahrten der Reihe nach ein
async function synchronisiere() {
  if (syncLaeuft || !navigator.onLine) return;
  syncLaeuft = true;

  try {
    let liste = ladeWarteschlange();
    let gesendet = 0;

    while (liste.length > 0) {
      const fahrt = liste[0];
      const datum = new Date(fahrt.timestamp).toLocaleString("de-DE");
      let ergebnis;
      try {
        ergebnis = await sendeFahrt(fahrt, `Offline erfasste Fahrt vom ${datum}:\n`);
      } catch {
        break;  // wieder offline → später erneut versuchen
      }

      if (ergebnis.status !== "ok") {
        if (ergebnis.status === "fehler") {
          zeigeStatus(`Offline erfasste Fahrt vom ${datum} konnte nicht gespeichert werden: ${ergebnis.meldung}`, "danger");
        }
        break;  // bleibt in der Warteschlange
      }

      liste = liste.slice(1);
      speichereWarteschlange(liste);
      gesendet++;
    }

    if (gesendet > 0) {
      zeigeStatus(`✅ ${gesendet} offline erfasste Fahrt(en) nachträglich gespeichert.`);
    }
  } finally {
    syncLaeuft = false;
    aktualisiereOfflineHinweis();
  }
}

// ── Erfassen ─────────────────────────────────────────────────

function formularLeeren() {
  document.getElementById("kmstand").value = "";
  document.getElementById("ziel").value = "";
}

function inWarteschlange(fahrt) {
  speichereWarteschlange([...ladeWarteschlange(), fahrt]);
  formularLeeren();
  zeigeStatus("📴 Keine Verbindung – Fahrt lokal gespeichert. Sie wird automatisch übertragen, sobald du wieder online bist.", "warning");
}

async function addFahrt() {
  const kmstand  = document.getElementById("kmstand").value;
  const ziel     = document.getElementById("ziel").value.trim();
  const fahrtart = document.querySelector('input[name="fahrtart"]:checked')?.value;

  if (!kmstand || !ziel || !fahrtart) {
    return zeigeStatus("Bitte alle Felder ausfüllen!", "warning");
  }

  // Zeitpunkt wird bei der Erfassung festgehalten, auch wenn erst später gesendet wird
  const fahrt = { kmstand, ziel, fahrtart, timestamp: new Date().toISOString() };

  const vehicleGroup = document.getElementById("vehicleGroup");
  if (!vehicleGroup.classList.contains("d-none")) {
    fahrt.vehicle_code = document.getElementById("vehicleSelect").value;
  }

  if (!navigator.onLine) return inWarteschlange(fahrt);

  try {
    const ergebnis = await sendeFahrt(fahrt);
    if (ergebnis.status === "ok") {
      formularLeeren();
      zeigeStatus("✅ Fahrt erfolgreich gespeichert!");
    } else if (ergebnis.status === "fehler") {
      zeigeStatus(ergebnis.meldung, "danger");
    }
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
    inWarteschlange(fahrt);  // Netzwerkfehler → offline behandeln
  }
}

// ── Export ───────────────────────────────────────────────────

// Aktueller Monat in lokaler Zeit (toISOString wäre UTC)
function aktuellerMonat() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function downloadCSV() {
  const jahr = new Date().getFullYear();
  downloadDatei(`/api/export/csv/year/${jahr}`, `fahrten_${jahr}.csv`);
}

function downloadJSON() {
  const month = aktuellerMonat();
  downloadDatei(`/api/export/json?month=${month}`, `fahrten_${month}.json`);
}

// ── Start ────────────────────────────────────────────────────

window.addEventListener("online", synchronisiere);
document.addEventListener("DOMContentLoaded", () => {
  aktualisiereOfflineHinweis();
  document.getElementById("syncJetzt").addEventListener("click", synchronisiere);
  document.getElementById("vehicleSelect").addEventListener("change", e => {
    localStorage.setItem(LETZTES_FAHRZEUG_KEY, e.target.value);
  });
  ladeFahrzeuge();
  synchronisiere();
});
