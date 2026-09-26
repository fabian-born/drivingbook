// js/driving-new.js
// Record a new trip – offline too: trips without a connection go into the
// queue (offline.js) and are sent later automatically.

const $ = id => document.getElementById(id);
const LAST_READING_KEY = code => `letzterStand:${code}`;   // for the hint, offline too

let lastReading = null;   // { km, zeit } of the active vehicle's last trip

// ── Vehicle & last reading ───────────────────────────────────
// New trips always belong to the active vehicle from the navigation.

function relativeTime(iso) {
  const rtf  = new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" });
  const diff = new Date(iso) - new Date();
  const days = Math.round(diff / 86400e3);
  if (Math.abs(days) >= 1) return rtf.format(days, "day");
  const hours = Math.round(diff / 3600e3);
  return Math.abs(hours) >= 1 ? rtf.format(hours, "hour") : t("driving.justNow");
}

function rememberLastReading(code, reading) {
  lastReading = reading;
  try { localStorage.setItem(LAST_READING_KEY(code), JSON.stringify(reading)); } catch { /* optional */ }
  showLastReading();
}

function showLastReading() {
  $("letzterStand").textContent = lastReading
    ? t("driving.lastReading", { km: lastReading.km.toLocaleString(i18n.locale), time: relativeTime(lastReading.time) })
    : t("driving.noTripYet");
  $("kmstand").placeholder = lastReading ? String(lastReading.km) : "0";
  updateKmHint();
}

async function showVehicle() {
  const vehicle = await vehicleReady;
  if (!vehicle) {
    $("fahrzeugName").textContent = t("driving.noVehicle");
    $("letzterStand").textContent = t("driving.manageVehicles");
    return;   // backend saves without assignment
  }

  $("fahrzeugName").textContent = vehicle.name;
  $("fahrzeugKennzeichen").textContent = vehicle.license_plate ?? "";
  $("fahrzeugKennzeichen").classList.toggle("d-none", !vehicle.license_plate);

  try {
    lastReading = JSON.parse(localStorage.getItem(LAST_READING_KEY(vehicle.code)));
  } catch { lastReading = null; }
  showLastReading();

  try {
    const res = await apiFetch(`/api/vehicles/${vehicle.id}/info`);
    if (!res.ok) return;
    const { overall } = await res.json();
    rememberLastReading(vehicle.code, overall.odometer_current != null
      ? { km: overall.odometer_current, time: overall.last_trip }
      : null);
  } catch { /* offline → last known reading */ }
}

// Live hint below the km field: difference to the last trip
function updateKmHint() {
  const hint = $("kmHinweis");
  const rawValue    = $("kmstand").value;
  hint.classList.remove("text-danger", "text-success");
  $("kmstand").classList.remove("is-invalid");

  if (!rawValue || !lastReading) {
    hint.innerHTML = "&nbsp;";
    return;
  }
  const diff = Number(rawValue) - lastReading.km;
  if (diff < 0) {
    hint.textContent = t("driving.belowLast", { km: lastReading.km.toLocaleString(i18n.locale) });
    hint.classList.add("text-danger");
    $("kmstand").classList.add("is-invalid");
  } else {
    hint.textContent = t("driving.sinceLast", { km: diff.toLocaleString(i18n.locale) });
    hint.classList.add("text-success");
  }
}

// ── Location ─────────────────────────────────────────────────

function fetchLocation() {
  if (!navigator.geolocation) return showStatus(t("driving.geoUnsupported"), "warning");
  const btn = $("standortBtn");
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    async position => {
      await applyPosition(position);
      btn.disabled = false;
    },
    error => {
      const msgs = [t("driving.geoDenied"), t("driving.geoUnavailable"), t("driving.geoTimeout")];
      showStatus(msgs[error.code - 1] || t("driving.geoUnknown"), "warning");
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function applyPosition(position) {
  const lat = position.coords.latitude.toFixed(6);
  const lon = position.coords.longitude.toFixed(6);
  const destinationField = $("ziel");

  // Offline: enter coordinates – the backend resolves them to an address when saving
  if (!navigator.onLine) {
    destinationField.value = `${lat}, ${lon}`;
    return;
  }

  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`);
    const addr = (await res.json()).address || {};
    const street = [addr.road, addr.house_number].filter(Boolean).join(" ");
    const place     = [addr.postcode, addr.city || addr.town || addr.village].filter(Boolean).join(" ");
    destinationField.value = [street, place].filter(Boolean).join(", ") || `${lat}, ${lon}`;
  } catch (err) {
    console.error("Standort:", err);
    destinationField.value = `${lat}, ${lon}`;
  }
}

// ── Status display ───────────────────────────────────────────

function showStatus(text, type = "success") {
  const box = $("statusMeldung");
  box.className   = `alert alert-${type}`;
  box.textContent = text;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ── Offline queue ────────────────────────────────────────────

function updateOfflineHint(count, failed = []) {
  $("offlineHinweis").classList.toggle("d-none", count === 0);
  $("offlineAnzahl").textContent = t("driving.waiting", { count: count });

  $("offlineFehler").classList.toggle("d-none", failed.length === 0);
  $("offlineFehlerListe").innerHTML = failed.map((f, i) => `
    <li class="border-top border-danger-subtle pt-2">
      <div class="small"><strong>${escapeHtml(new Date(f.timestamp).toLocaleString(i18n.locale))}</strong> ·
        ${escapeHtml(Number(f.odometer_km).toLocaleString(i18n.locale))} km · ${escapeHtml(f.destination)}</div>
      <div class="small text-danger-emphasis mb-1">${escapeHtml(f.fehler)}</div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-sm btn-outline-danger" data-resend="${i}">${escapeHtml(t("driving.resend"))}</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-discard="${i}">${escapeHtml(t("driving.discard"))}</button>
      </div>
    </li>`).join("");
  offlineErrorShown = failed;
}

let offlineErrorShown = [];

// ── Record ───────────────────────────────────────────────────

function clearForm() {
  $("kmstand").value = "";
  $("ziel").value = "";
  updateKmHint();
}

// After saving (or queueing), the new reading becomes the last reading
function onTripSaved(trip) {
  if (activeVehicle) rememberLastReading(activeVehicle.code, { km: Number(trip.odometer_km), time: trip.timestamp });
  clearForm();
}

function onTripQueued(trip) {
  enqueueTrip(trip);
  onTripSaved(trip);
  showStatus(t("driving.queued"), "warning");
}

function setSaving(isActive) {
  $("speichernBtn").disabled = isActive;
  $("speichernSpinner").classList.toggle("d-none", !isActive);
}

async function addTrip() {
  const odometer  = $("kmstand").value;
  const target     = $("ziel").value.trim();
  const tripType = document.querySelector('input[name="fahrtart"]:checked')?.value;

  if (!odometer || !target || !tripType) {
    (odometer ? $("ziel") : $("kmstand")).focus();
    return showStatus(t("driving.required"), "warning");
  }

  // Timestamp is captured at entry time, even if sent later
  const trip = { odometer_km: odometer, destination: target, trip_type: tripType, timestamp: new Date().toISOString() };

  // Code is captured at entry time, even if sent later while offline
  const vehicle = await vehicleReady;
  if (vehicle) trip.vehicle_code = vehicle.code;

  if (!navigator.onLine) return onTripQueued(trip);

  setSaving(true);   // prevents duplicate entries from double taps
  try {
    const result = await sendTrip(trip);
    if (result.status === "ok") {
      onTripSaved(trip);
      showStatus(t("driving.saved"));
    } else if (result.status === "fehler") {
      showStatus(result.message, "danger");
    }
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
    onTripQueued(trip);  // network error → handle as offline
  } finally {
    setSaving(false);
  }
}

// ── Start ────────────────────────────────────────────────────

// Show queue messages in the form instead of as a top-right notice
document.addEventListener("warteschlange", e => {
  e.preventDefault();
  showStatus(e.detail.text, e.detail.type);
});
document.addEventListener("warteschlangeGeaendert", e => updateOfflineHint(e.detail.count, e.detail.failed));

document.addEventListener("DOMContentLoaded", () => {
  updateQueueDisplay();
  $("offlineFehlerListe").addEventListener("click", e => {
    const retryBtn    = e.target.closest("[data-resend]");
    const discardBtn = e.target.closest("[data-discard]");
    if (retryBtn) resendPending(offlineErrorShown[retryBtn.dataset.resend]);
    if (discardBtn && confirm(t("driving.confirmDiscard"))) {
      discardPending(offlineErrorShown[discardBtn.dataset.discard]);
    }
  });
  $("syncJetzt").addEventListener("click", synchronize);
  $("standortBtn").addEventListener("click", fetchLocation);
  $("kmstand").addEventListener("input", updateKmHint);
  $("fahrtFormular").addEventListener("submit", e => {
    e.preventDefault();
    addTrip();
  });
  showVehicle();
  onRefresh(showVehicle);   // refresh last odometer reading
});
