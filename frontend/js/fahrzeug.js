// js/fahrzeug.js
// Active vehicle ("context"): chosen after login or in the navigation
// and applies to all pages – display, statistics, export and new
// trips refer to this vehicle only.

const AKTIVES_FAHRZEUG_KEY = "aktivesFahrzeug";
const FAHRZEUGE_CACHE_KEY  = "fahrzeuge";   // for offline use

let alleFahrzeuge   = [];
let aktivesFahrzeug = null;   // { id, name, code, is_default } or null if the user has none

function waehleFahrzeug(code) {
  localStorage.setItem(AKTIVES_FAHRZEUG_KEY, code);
}

// Appends ?vehicle=CODE of the active vehicle to an API path
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

// Pages await this before loading data
const fahrzeugBereit = (async () => {
  try {
    const res = await apiFetch("/api/vehicles");
    if (res.ok) {
      alleFahrzeuge = await res.json();
      localStorage.setItem(FAHRZEUGE_CACHE_KEY, JSON.stringify(alleFahrzeuge));
    }
  } catch {
    // offline → use the last known vehicle list
    try { alleFahrzeuge = JSON.parse(localStorage.getItem(FAHRZEUGE_CACHE_KEY)) || []; } catch { /* empty */ }
  }

  // Saved choice, otherwise the default vehicle (e.g. if the chosen one was deleted)
  const code = localStorage.getItem(AKTIVES_FAHRZEUG_KEY);
  aktivesFahrzeug = alleFahrzeuge.find(v => v.code === code)
    ?? alleFahrzeuge.find(v => v.is_default)
    ?? alleFahrzeuge[0]
    ?? null;
  if (aktivesFahrzeug) waehleFahrzeug(aktivesFahrzeug.code);

  zeigeFahrzeugAuswahl();
  return aktivesFahrzeug;
})();
