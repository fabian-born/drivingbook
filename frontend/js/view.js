document.addEventListener("DOMContentLoaded", () => {

const yearSelect  = document.getElementById("jahrSelect");
const monthSelect = document.getElementById("monatSelect");
const tbody       = document.getElementById("fahrtenTabelle");
const cardList    = document.getElementById("cardList") ?? document.createElement("div");
const tripTypeFilter = document.getElementById("fahrtartFilter");
const csvExportBtn   = document.getElementById("csvExportYear");

let currentTrips = [];
let yearView   = false;
let vehicles      = [];
let vehicleById   = new Map();

// ----------------- Vehicles (names in the audit log) -----------------
// Only trips of the active vehicle are shown (see fahrzeug.js).
async function loadVehicles() {
  await Promise.all([vehicleReady, initialSync]);
  vehicles    = allVehicles;
  vehicleById = new Map(vehicles.map(v => [v.id, v]));
}

// ----------------- Helper: currently on mobile? -----------------
function isMobile() {
  return window.innerWidth < 768;
}

// ----------------- Fill years -----------------
function fillYears() {
  const currentYear = new Date().getFullYear();
  yearSelect.innerHTML = "";
  for (let j = currentYear; j >= START_YEAR; j--) {
    yearSelect.innerHTML += `<option value="${j}">${j}</option>`;
  }
}

// ----------------- Load the year's trips (one request) -----------------
// Returns all trips of the selected year incl. distance; months are filtered locally
let yearTrips = [];

async function loadYear() {
  const res = await apiFetch(withVehicle(`/api/trips?year=${yearSelect.value}`));
  if (!res.ok) throw new Error(await apiError(res));
  yearTrips = (await res.json()).trips;
}

// ----------------- Fill months & preselect current month -----------------
async function fillMonths() {
  const selectedYear           = yearSelect.value;
  const currentYear  = new Date().getFullYear();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");

  setLoading();
  try {
    await loadYear();
  } catch {
    setEmpty(t("view.loadError"));
    return;
  }

  const monthsWithData = new Set(yearTrips.map(f => f.month.slice(5)));
  const monthName = mm => new Date(2000, Number(mm) - 1, 1).toLocaleString(i18n.locale, { month: "short" });
  monthSelect.innerHTML = `<option value="alle">${t("view.all")}</option>` +
    Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))
      .map(mm => `<option value="${mm}" ${monthsWithData.has(mm) ? "" : "disabled"}>${monthName(mm)}</option>`)
      .join("");

  // Current year → prefer current month, otherwise the first one with data
  const initialMonth = String(selectedYear) === String(currentYear) && monthsWithData.has(currentMonth)
    ? currentMonth
    : [...monthsWithData].sort()[0];

  if (initialMonth) {
    monthSelect.value = initialMonth;
    showSelection();
  } else {
    currentTrips = [];
    setEmpty(t("view.noDataThisYear"));
  }
}

// ----------------- Show selected month (or all) from the year's data -----------------
function showSelection() {
  const month = monthSelect.value;
  yearView   = month === "alle";
  currentTrips = yearView
    ? [...yearTrips]
    : yearTrips.filter(f => f.month === `${yearSelect.value}-${month}`);

  if (currentTrips.length === 0) {
    setEmpty(yearView ? t("view.noDataForYear", { year: yearSelect.value }) : t("view.noData"));
    return;
  }
  renderAll();
}

// ----------------- Reload trips from the server (selection is kept) -----------------
async function loadTrips() {
  if (!yearSelect.value || !monthSelect.value) return;
  try {
    await loadYear();
  } catch {
    setEmpty(t("view.loadError"));
    return;
  }
  // Enable months with new trips, selection is kept
  const monthsWithData = new Set(yearTrips.map(f => f.month.slice(5)));
  for (const option of monthSelect.options) {
    if (option.value !== "alle") option.disabled = !monthsWithData.has(option.value);
  }
  showSelection();
}

// ----------------- Render-Dispatcher -----------------
function renderAll() {
  renderTotals();
  if (yearView) {
    renderTableYearView();
    renderCardsYearView();
  } else {
    renderTable();
    renderCards();
  }
}

// ═══════════════════════════════════════════════
// DESKTOP: Table rendering
// ═══════════════════════════════════════════════

function renderTable() {
  tbody.innerHTML = "";
  const filter = tripTypeFilter.value;

  currentTrips.forEach((f, i) => {
    if (filter !== "alle" && f.trip_type !== filter) return;
    const diff = f.distance ?? 0;

    const tr = document.createElement("tr");
    tr.dataset.index = i;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td contenteditable="true" data-field="odometer_km">${escapeHtml(f.odometer_km)}</td>
      <td>${diff}</td>
      <td contenteditable="true" data-field="destination">${escapeHtml(f.destination)}</td>
      <td>
        <select class="form-select form-select-sm fahrtart-select" data-index="${i}">
          ${tripTypeOptions(f.trip_type)}
        </select>
      </td>
      <td>
        <input type="datetime-local" class="form-control form-control-sm timestamp-input"
          data-index="${i}" value="${toDatetimeLocal(f.timestamp)}">
      </td>
      <td class="text-center text-nowrap">
        ${historyButton(f)}
        <button class="btn btn-sm btn-outline-danger delete-btn" data-index="${i}" title="${t("view.delete.button")}">
          <span class="mdi mdi-delete"></span>
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderTableYearView() {
  tbody.innerHTML = "";
  const filter = tripTypeFilter.value;
  let groupMonth = null;
  let nr = 0;

  currentTrips.forEach((f, i) => {
    if (filter !== "alle" && f.trip_type !== filter) return;
    const month = monthKeyFromISO(f.timestamp);

    if (month !== groupMonth) {
      groupMonth = month;
      nr = 0;
      const trH = document.createElement("tr");
      trH.className = "table-dark";
      trH.innerHTML = `<td colspan="7" class="fw-bold small">
        <span class="mdi mdi-calendar-month me-1"></span>${formatMonth(month)}
      </td>`;
      tbody.appendChild(trH);
    }

    nr++;
    const diff = f.distance ?? 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${nr}</td>
      <td>${escapeHtml(f.odometer_km)}</td>
      <td>${diff >= 0 ? diff : "–"}</td>
      <td>${escapeHtml(f.destination)}</td>
      <td>${tripTypeBadge(f.trip_type)}</td>
      <td>${new Date(f.timestamp).toLocaleString(i18n.locale)}</td>
      <td class="text-center">${historyButton(f)}</td>`;
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════
// MOBILE: Card rendering
// ═══════════════════════════════════════════════

function renderCards() {
  cardList.innerHTML = "";
  const filter = tripTypeFilter.value;

  currentTrips.forEach((f, i) => {
    if (filter !== "alle" && f.trip_type !== filter) return;
    const diff = f.distance ?? 0;
    cardList.appendChild(buildCard(f, i, diff, false));
  });
}

function renderCardsYearView() {
  cardList.innerHTML = "";
  const filter = tripTypeFilter.value;
  let groupMonth = null;
  let nr = 0;

  currentTrips.forEach((f, i) => {
    if (filter !== "alle" && f.trip_type !== filter) return;
    const month = monthKeyFromISO(f.timestamp);

    if (month !== groupMonth) {
      groupMonth = month;
      nr = 0;
      const div = document.createElement("div");
      div.className = "month-divider";
      div.innerHTML = `<span class="mdi mdi-calendar-month me-1"></span>${formatMonth(month)}`;
      cardList.appendChild(div);
    }

    nr++;
    const diff = f.distance ?? 0;
    cardList.appendChild(buildCard(f, i, diff, true, nr));
  });
}

function buildCard(f, i, diff, readonly, nr) {
  const when = new Date(f.timestamp).toLocaleString(i18n.locale, { dateStyle: "medium", timeStyle: "short" });
  const distanceText   = f.distance == null ? "" : `+${num(Math.max(diff, 0))} km`;

  const div = document.createElement("div");
  div.className = "fahrt-card";
  div.dataset.index = i;
  div.style.setProperty("--fahrtart-farbe", tripTypeInfo(f.trip_type).chart);

  if (readonly) {
    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-center gap-2">
        <span class="card-meta">${escapeHtml(when)}</span>
        ${tripTypeBadge(f.trip_type)}
      </div>
      <div class="d-flex align-items-baseline gap-2 mt-1">
        <span class="card-km">${num(f.odometer_km)} km</span>
        <span class="strecke">${distanceText}</span>
      </div>
      <div class="card-ziel">${escapeHtml(f.destination)}</div>
      <div class="d-flex justify-content-between align-items-center mt-1">
        <span class="card-meta">#${nr ?? i + 1}</span>${historyButton(f)}
      </div>`;
  } else {
    div.innerHTML = `
      <div class="d-flex align-items-center gap-2 mb-2">
        <input type="datetime-local" class="form-control card-timestamp" aria-label="${t("view.col.time")}"
          data-index="${i}" value="${toDatetimeLocal(f.timestamp)}">
        <button class="btn btn-outline-danger btn-icon delete-btn" data-index="${i}" title="${t("view.delete.title")}" aria-label="${t("view.delete.title")}">
          <span class="mdi mdi-delete"></span>
        </button>
      </div>

      <div class="d-flex align-items-center gap-2 mb-2">
        <div class="input-group km-feld">
          <input type="number" inputmode="numeric" class="form-control card-field-km" aria-label="${t("view.odometer")}"
            data-index="${i}" data-field="odometer_km" value="${escapeHtml(f.odometer_km)}">
          <span class="input-group-text">km</span>
        </div>
        <span class="strecke">${distanceText}</span>
      </div>

      <input type="text" class="form-control mb-2 card-field-ziel" aria-label="${t("view.col.destination")}"
        data-index="${i}" data-field="destination" value="${escapeHtml(f.destination)}">

      <div class="d-flex align-items-center gap-2">
        <select class="form-select card-fahrtart" data-index="${i}" aria-label="${t("view.tripType")}">
          ${tripTypeOptions(f.trip_type)}
        </select>
        <span class="card-meta">#${i + 1}</span>${historyButton(f)}
      </div>`;
  }

  return div;
}

// ----------------- Total of the displayed trips -----------------
function renderTotals() {
  const box = document.getElementById("auswahlSumme");
  const filter = tripTypeFilter.value;
  const trips = currentTrips.filter(f => filter === "alle" || f.trip_type === filter);
  box.classList.toggle("d-none", trips.length === 0);
  if (trips.length === 0) return;

  const sums = Object.fromEntries(TRIP_TYPES.map(a => [a.key, 0]));
  for (const f of trips) sums[tripTypeInfo(f.trip_type).key] += Math.max(f.distance ?? 0, 0);
  const grandTotal = TRIP_TYPES.reduce((n, a) => n + sums[a.key], 0);

  document.getElementById("auswahlTitel").textContent = yearView
    ? t("analysis.year", { year: yearSelect.value })
    : formatMonth(`${yearSelect.value}-${monthSelect.value}`);
  document.getElementById("auswahlKm").textContent      = kmText(grandTotal);
  document.getElementById("auswahlFahrten").textContent = `· ${t("analysis.trips", { count: trips.length, n: trips.length })}`;
  document.getElementById("auswahlBalken").innerHTML    = splitBar(sums, { height: 8 });
  document.getElementById("auswahlLegende").innerHTML   = TRIP_TYPES.map(a => `
    <span class="text-nowrap"><span class="d-inline-block rounded-1 me-1" style="width:8px;height:8px;background:${a.chart}"></span>${a.label} ${num(sums[a.key])} km</span>`).join("");
}

// ═══════════════════════════════════════════════
// Card events (mobile)
// ═══════════════════════════════════════════════

cardList.addEventListener("change", async e => {
  if (yearView) return;

  // Trip type dropdown
  if (e.target.classList.contains("card-fahrtart")) {
    const i = e.target.dataset.index;
    currentTrips[i].trip_type = e.target.value;
    e.target.closest(".fahrt-card").style.setProperty("--fahrtart-farbe", tripTypeInfo(e.target.value).chart);
    if (await saveTrip(i)) renderTotals();
  }

  // Timestamp
  if (e.target.classList.contains("card-timestamp")) {
    const i = e.target.dataset.index;
    const localVal = e.target.value;
    if (!localVal) return;
    await handleTimestampChange(i, localVal);
  }
});

cardList.addEventListener("blur", async e => {
  if (yearView) return;

  if (e.target.classList.contains("card-field-km")) {
    const i = e.target.dataset.index;
    currentTrips[i].odometer_km = Number(e.target.value);
    await saveTrip(i);
  }

  if (e.target.classList.contains("card-field-ziel")) {
    const i = e.target.dataset.index;
    currentTrips[i].destination = e.target.value;
    await saveTrip(i);
  }
}, true);

// History buttons also work in the (otherwise read-only) year view
[cardList, tbody].forEach(el => el.addEventListener("click", e => {
  const btn = e.target.closest(".history-btn");
  if (btn) showHistory(btn.dataset.id);
}));

cardList.addEventListener("click", e => {
  if (yearView) return;
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  showDeleteModal(btn.dataset.index);
});

// ═══════════════════════════════════════════════
// Table events (desktop)
// ═══════════════════════════════════════════════

tbody.addEventListener("blur", async e => {
  if (yearView) return;
  if (!e.target.dataset.field) return;
  const tr    = e.target.closest("tr");
  const index = tr.dataset.index;
  const field = e.target.dataset.field;
  currentTrips[index][field] =
    field === "odometer_km" ? Number(e.target.innerText) : e.target.innerText;
  await saveTrip(index);
}, true);

tbody.addEventListener("change", async e => {
  if (yearView) return;

  if (e.target.classList.contains("fahrtart-select")) {
    const i = e.target.dataset.index;
    currentTrips[i].trip_type = e.target.value;
    if (await saveTrip(i)) renderTotals();
  }

  if (e.target.classList.contains("timestamp-input")) {
    const i = e.target.dataset.index;
    if (!e.target.value) return;
    await handleTimestampChange(i, e.target.value);
  }
});

tbody.addEventListener("click", e => {
  if (yearView) return;
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  showDeleteModal(btn.dataset.index);
});

// ═══════════════════════════════════════════════
// Shared Logic
// ═══════════════════════════════════════════════

async function handleTimestampChange(index, localVal) {
  const oldMonthKey  = `${yearSelect.value}-${monthSelect.value}`;
  const newTimestamp = new Date(localVal).toISOString();
  const newMonthKey  = monthKeyFromISO(newTimestamp);
  if (!newMonthKey) return;

  const saved = await saveTrip(index, { timestamp: newTimestamp });
  if (!saved) return;

  currentTrips[index].timestamp = newTimestamp;
  if (newMonthKey !== oldMonthKey) {
    // Trip now belongs to another month → reload the year's data and distances
    await loadTrips();
    showHint(t("view.moved", { month: newMonthKey }), "info");
  }
}

// Saves changes to a trip by ID. Without `aenderungen`, the
// editable fields from aktuelleFahrten[index] are sent.
async function saveTrip(index, changes) {
  const trip = currentTrips[index];
  const body  = changes ?? {
    odometer_km: trip.odometer_km,
    destination: trip.destination,
    trip_type:   trip.trip_type,
  };

  try {
    let res = await apiFetch(`/api/trips/${trip.id}`, { method: "PUT", body });

    // Odometer reading doesn't match the neighbouring trips → ask and force if confirmed
    if (res.status === 409) {
      const err = await res.json().catch(() => ({}));
      if (err.code === "KM_PLAUSIBILITY" && confirm(`${err.error}\n\n${t("offline.saveAnyway")}`)) {
        res = await apiFetch(`/api/trips/${trip.id}`, { method: "PUT", body: { ...body, force: true } });
      } else {
        showHint(t("view.notSaved", { error: err.error || res.status }), "warning");
        loadTrips();  // reset the display to the saved state
        return false;
      }
    }

    if (!res.ok) {
      showHint(`${t("common.saveError")}: ${await apiError(res)}`, "danger");
      return false;
    }
    trip.edited = true;
    return true;
  } catch (err) {
    console.error("Speicherfehler:", err);
    showHint(`${t("common.saveError")}.`, "danger");
    return false;
  }
}

function showDeleteModal(index) {
  const trip    = currentTrips[index];
  const when = new Date(trip.timestamp).toLocaleString(i18n.locale);

  document.getElementById("confirmDeleteInfo").textContent =
    `#${parseInt(index) + 1} · ${trip.odometer_km} km · ${trip.destination} · ${trip.trip_type} · ${when}`;
  document.getElementById("confirmDeleteIndex").value = index;

  new bootstrap.Modal(document.getElementById("deleteModal")).show();
}

document.getElementById("confirmDeleteBtn")?.addEventListener("click", async () => {
  const index = document.getElementById("confirmDeleteIndex").value;
  const trip = currentTrips[index];

  try {
    const res = await apiFetch(`/api/trips/${trip.id}`, { method: "DELETE" });
    if (res.ok) {
      bootstrap.Modal.getInstance(document.getElementById("deleteModal")).hide();
      await loadTrips();  // the following trip's distance changes too
    } else {
      alert(t("view.deleteError"));
    }
  } catch (err) {
    alert(t("view.deleteError"));
  }
});

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function toDatetimeLocal(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function monthKeyFromISO(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(monthKey) {
  if (!monthKey) return monthKey;
  const [y, m] = monthKey.split("-");
  return new Date(y, parseInt(m) - 1).toLocaleString(i18n.locale, { month: "long", year: "numeric" });
}

function setLoading(text = t("view.loading")) {
  tbody.innerHTML   = `<tr><td colspan="7">${escapeHtml(text)}</td></tr>`;
  cardList.innerHTML = `<p class="text-muted small">${escapeHtml(text)}</p>`;
}

function setEmpty(text) {
  document.getElementById("auswahlSumme").classList.add("d-none");
  tbody.innerHTML   = `<tr><td colspan="7">${escapeHtml(text)}</td></tr>`;
  cardList.innerHTML = `<p class="text-muted small">${escapeHtml(text)}</p>`;
}

function showHint(text, type = "info") {
  let container = document.getElementById("hinweisContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "hinweisContainer";
    container.style.cssText = "position:fixed;top:1rem;right:1rem;z-index:9999;min-width:280px;";
    document.body.appendChild(container);
  }
  const div = document.createElement("div");
  div.className = `alert alert-${type} alert-dismissible fade show shadow`;
  div.innerHTML = `${escapeHtml(text)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

// ═══════════════════════════════════════════════
// Filter & Export & Swipe
// ═══════════════════════════════════════════════

tripTypeFilter.addEventListener("change", renderAll);

csvExportBtn?.addEventListener("click", () => {
  downloadFile(withVehicle(`/api/export/csv/year/${yearSelect.value}`), `${t("view.fileCsv")}_${yearSelect.value}.csv`);
});

document.getElementById("pdfExportYear")?.addEventListener("click", () => {
  downloadFile(withVehicle(`/api/export/pdf/year/${yearSelect.value}`), `${t("view.filePdf")}_${yearSelect.value}.pdf`);
});

let startX = 0;
const swipeTarget = document.body;
swipeTarget.addEventListener("touchstart", e => startX = e.touches[0].clientX);
swipeTarget.addEventListener("touchend", e => {
  if (yearView) return;
  const diff = e.changedTouches[0].clientX - startX;
  if (Math.abs(diff) < 60) return;
  const opts = [...monthSelect.options].filter(o => o.value !== "alle" && !o.disabled);
  if (opts.length === 0) return;
  const curIdx = opts.findIndex(o => o.value === monthSelect.value);
  if (diff < 0 && curIdx < opts.length - 1) monthSelect.value = opts[curIdx + 1].value;
  if (diff > 0 && curIdx > 0)               monthSelect.value = opts[curIdx - 1].value;
  showSelection();
});

// ═══════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════

yearSelect.addEventListener("change", fillMonths);
monthSelect.addEventListener("change", showSelection);

// ═══════════════════════════════════════════════
// Audit log
// ═══════════════════════════════════════════════

function historyButton(f) {
  if (!f.edited) return "";
  return `<button class="btn btn-sm btn-outline-secondary history-btn" data-id="${escapeHtml(f.id)}"
            title="${t("view.history.button")}">
            <span class="mdi mdi-history"></span>
          </button>`;
}

const FIELD_LABELS = { odometer_km: t("view.odometer"), destination: t("view.field.destination"), trip_type: t("view.tripType"),
                      timestamp: t("view.col.time"), vehicle_id: t("view.field.vehicle") };
const ACTION_LABELS    = { create: t("view.action.create"), update: t("view.action.update"), delete: t("view.action.delete") };
const SOURCE_LABELS     = { web: "Web", api_token: t("view.source.apiToken"), admin: t("nav.admin") };
const sourceText  = source => SOURCE_LABELS[source] || source;

function formatValue(fieldName, rawValue) {
  if (rawValue == null) return "–";
  if (fieldName === "timestamp")   return new Date(rawValue).toLocaleString(i18n.locale);
  if (fieldName === "odometer_km") return `${rawValue} km`;
  if (fieldName === "trip_type")   return tripTypeInfo(rawValue).label;
  if (fieldName === "vehicle_id")  return vehicleById.get(rawValue)?.name ?? t("view.vehicleNumber", { id: rawValue });
  return String(rawValue);
}

// Describes an audit log entry as HTML (values are escaped)
function describeEntry(e) {
  if (e.action === "update") {
    const rows = Object.keys(FIELD_LABELS)
      .filter(f => JSON.stringify(e.old_data?.[f]) !== JSON.stringify(e.new_data?.[f]))
      .map(f => `${FIELD_LABELS[f]}: <del>${escapeHtml(formatValue(f, e.old_data?.[f]))}</del>
                 → <strong>${escapeHtml(formatValue(f, e.new_data?.[f]))}</strong>`);
    return rows.length ? rows.join("<br>") : escapeHtml(t("view.history.noChange"));
  }
  const d = e.action === "delete" ? e.old_data : e.new_data;
  return escapeHtml(`${formatValue("timestamp", d.timestamp)} · ${formatValue("odometer_km", d.odometer_km)} · ${formatValue("trip_type", d.trip_type)} · ${d.destination}`);
}

function showAuditLog(title, entries, emptyText) {
  document.getElementById("auditModalLabel").textContent = title;
  document.getElementById("auditModalBody").innerHTML = entries.length === 0
    ? `<p class="text-muted mb-0">${escapeHtml(emptyText)}</p>`
    : `<ul class="list-group list-group-flush">${entries.map(e => `
        <li class="list-group-item px-0">
          <div class="d-flex justify-content-between small text-muted mb-1">
            <span>${escapeHtml(new Date(e.changed_at).toLocaleString(i18n.locale))} · ${escapeHtml(sourceText(e.source))}</span>
            <span>${e.trip_id ? `${tHtml("view.tripId", { id: e.trip_id })} · ` : ""}${escapeHtml(ACTION_LABELS[e.action] || e.action)}</span>
          </div>
          <div class="small">${describeEntry(e)}</div>
        </li>`).join("")}</ul>`;
  bootstrap.Modal.getOrCreateInstance(document.getElementById("auditModal")).show();
}

async function showHistory(id) {
  const res = await apiFetch(`/api/trips/${id}/history`);
  if (!res.ok) return showHint(await apiError(res), "danger");
  showAuditLog(t("view.history.title"), await res.json(), t("view.history.empty"));
}

document.getElementById("auditYear")?.addEventListener("click", async () => {
  const selectedYear = yearSelect.value;
  const res  = await apiFetch(withVehicle(`/api/audit?year=${selectedYear}`));
  if (!res.ok) return showHint(await apiError(res), "danger");
  showAuditLog(t("view.audit.yearTitle", { year: selectedYear }), await res.json(),
    t("view.audit.empty", { year: selectedYear }));
});

loadVehicles().then(() => {
  fillYears();
  fillMonths();
  onRefresh(refreshList);
});

// Reload (late-synced trips, returning to the app, every 5 minutes);
// offline.js waits until no input is in progress
function refreshList() {
  // Empty view → recheck the month list (the month may still have been disabled)
  if (currentTrips.length === 0) return fillMonths();
  return loadTrips();
}

}); // DOMContentLoaded
