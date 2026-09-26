// js/fahrzeug.js
// Aktives Fahrzeug („Kontext“): wird nach dem Login bzw. in der Navigation
// gewählt und gilt für alle Seiten – Anzeige, Auswertung, Export und neue
// Fahrten beziehen sich nur auf dieses Fahrzeug.

const AKTIVES_FAHRZEUG_KEY = "aktivesFahrzeug";
const FAHRZEUGE_CACHE_KEY  = "fahrzeuge";   // für die Offline-Nutzung

let alleFahrzeuge   = [];
let aktivesFahrzeug = null;   // { id, name, code, is_default } oder null, falls der User keins hat

function waehleFahrzeug(code) {
  localStorage.setItem(AKTIVES_FAHRZEUG_KEY, code);
}

// Hängt ?vehicle=CODE des aktiven Fahrzeugs an einen API-Pfad an
function mitFahrzeug(path) {
  if (!aktivesFahrzeug) return path;
  return `${path}${path.includes("?") ? "&" : "?"}vehicle=${encodeURIComponent(aktivesFahrzeug.code)}`;
}

function zeigeFahrzeugAuswahl() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn || alleFahrzeuge.length === 0) return;

  const select = document.createElement("select");
  select.id        = "fahrzeugKontext";
  select.className = "form-select form-select-sm w-auto ms-lg-2 my-2 my-lg-0";
  select.title     = t("vehicle.active");
  select.setAttribute("aria-label", t("vehicle.active"));
  select.innerHTML = alleFahrzeuge.map(v =>
    `<option value="${escapeHtml(v.code)}" ${v.code === aktivesFahrzeug?.code ? "selected" : ""}>🚗 ${escapeHtml(v.name)}</option>`
  ).join("");
  select.addEventListener("change", () => {
    waehleFahrzeug(select.value);
    location.reload();
  });

  logoutBtn.before(select);
}

// Wird von den Seiten abgewartet, bevor sie Daten laden
const fahrzeugBereit = (async () => {
  try {
    const res = await apiFetch("/api/vehicles");
    if (res.ok) {
      alleFahrzeuge = await res.json();
      localStorage.setItem(FAHRZEUGE_CACHE_KEY, JSON.stringify(alleFahrzeuge));
    }
  } catch {
    // offline → zuletzt bekannte Fahrzeugliste verwenden
    try { alleFahrzeuge = JSON.parse(localStorage.getItem(FAHRZEUGE_CACHE_KEY)) || []; } catch { /* leer */ }
  }

  // Gespeicherte Auswahl, sonst Standard-Fahrzeug (z. B. wenn das gewählte gelöscht wurde)
  const code = localStorage.getItem(AKTIVES_FAHRZEUG_KEY);
  aktivesFahrzeug = alleFahrzeuge.find(v => v.code === code)
    ?? alleFahrzeuge.find(v => v.is_default)
    ?? alleFahrzeuge[0]
    ?? null;
  if (aktivesFahrzeug) waehleFahrzeug(aktivesFahrzeug.code);

  zeigeFahrzeugAuswahl();
  return aktivesFahrzeug;
})();
