// js/driving-new.js
// Neue Fahrt erfassen – auch offline: Fahrten ohne Verbindung landen in der
// Warteschlange (offline.js) und werden automatisch nachgereicht.

// ── Fahrzeug ─────────────────────────────────────────────────
// Neue Fahrten gehören immer zum aktiven Fahrzeug aus der Navigation.
async function zeigeFahrzeug() {
  const vehicle = await fahrzeugBereit;
  if (!vehicle) return;  // kein Fahrzeug → Backend speichert ohne Zuordnung
  document.getElementById("vehicleName").value = vehicle.name;
  document.getElementById("vehicleGroup").classList.remove("d-none");
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

function aktualisiereOfflineHinweis(anzahl) {
  document.getElementById("offlineHinweis").classList.toggle("d-none", anzahl === 0);
  document.getElementById("offlineAnzahl").textContent =
    anzahl === 1 ? "1 Fahrt wartet" : `${anzahl} Fahrten warten`;
}

// ── Erfassen ─────────────────────────────────────────────────

function formularLeeren() {
  document.getElementById("kmstand").value = "";
  document.getElementById("ziel").value = "";
}

function inWarteschlange(fahrt) {
  inWarteschlangeAufnehmen(fahrt);
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

  // Code wird bei der Erfassung festgehalten, auch wenn offline erst später gesendet wird
  const vehicle = await fahrzeugBereit;
  if (vehicle) fahrt.vehicle_code = vehicle.code;

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
  downloadDatei(mitFahrzeug(`/api/export/csv/year/${jahr}`), `fahrten_${jahr}.csv`);
}

function downloadJSON() {
  const month = aktuellerMonat();
  downloadDatei(mitFahrzeug(`/api/export/json?month=${month}`), `fahrten_${month}.json`);
}

// ── Start ────────────────────────────────────────────────────

// Meldungen der Warteschlange im Formular statt als Hinweis oben rechts anzeigen
document.addEventListener("warteschlange", e => {
  e.preventDefault();
  zeigeStatus(e.detail.text, e.detail.typ);
});
document.addEventListener("warteschlangeGeaendert", e => aktualisiereOfflineHinweis(e.detail.anzahl));

document.addEventListener("DOMContentLoaded", () => {
  aktualisiereOfflineHinweis(eigeneWartende().length);
  document.getElementById("syncJetzt").addEventListener("click", synchronisiere);
  zeigeFahrzeug();
});
