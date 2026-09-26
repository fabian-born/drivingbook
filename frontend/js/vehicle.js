// js/vehicle.js
// Active vehicle ("context"): chosen after login or in the navigation
// and applies to all pages – display, statistics, export and new
// trips refer to this vehicle only.

const ACTIVE_VEHICLE_KEY = "aktivesFahrzeug";
const VEHICLES_CACHE_KEY  = "fahrzeuge";   // for offline use

let allVehicles   = [];
let activeVehicle = null;   // { id, name, code, is_default } or null if the user has none

function selectVehicle(code) {
  localStorage.setItem(ACTIVE_VEHICLE_KEY, code);
}

// Appends ?vehicle=CODE of the active vehicle to an API path
function withVehicle(path) {
  if (!activeVehicle) return path;
  return `${path}${path.includes("?") ? "&" : "?"}vehicle=${encodeURIComponent(activeVehicle.code)}`;
}

function showVehiclePicker() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn || allVehicles.length === 0) return;

  const select = document.createElement("select");
  select.id        = "vehicleContext";
  select.className = "form-select form-select-sm w-auto ms-lg-2 my-2 my-lg-0";
  select.title     = t("vehicle.active");
  select.setAttribute("aria-label", t("vehicle.active"));
  select.innerHTML = allVehicles.map(v =>
    `<option value="${escapeHtml(v.code)}" ${v.code === activeVehicle?.code ? "selected" : ""}>🚗 ${escapeHtml(v.name)}</option>`
  ).join("");
  select.addEventListener("change", () => {
    selectVehicle(select.value);
    location.reload();
  });

  logoutBtn.before(select);
}

// Pages await this before loading data
const vehicleReady = (async () => {
  try {
    const res = await apiFetch("/api/vehicles");
    if (res.ok) {
      allVehicles = await res.json();
      localStorage.setItem(VEHICLES_CACHE_KEY, JSON.stringify(allVehicles));
    }
  } catch {
    // offline → use the last known vehicle list
    try { allVehicles = JSON.parse(localStorage.getItem(VEHICLES_CACHE_KEY)) || []; } catch { /* empty */ }
  }

  // Saved choice, otherwise the default vehicle (e.g. if the chosen one was deleted)
  const code = localStorage.getItem(ACTIVE_VEHICLE_KEY);
  activeVehicle = allVehicles.find(v => v.code === code)
    ?? allVehicles.find(v => v.is_default)
    ?? allVehicles[0]
    ?? null;
  if (activeVehicle) selectVehicle(activeVehicle.code);

  showVehiclePicker();
  return activeVehicle;
})();
