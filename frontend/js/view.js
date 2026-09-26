document.addEventListener("DOMContentLoaded", () => {

const jahrSelect  = document.getElementById("jahrSelect");
const monatSelect = document.getElementById("monatSelect");
const tbody       = document.getElementById("fahrtenTabelle");
const cardList    = document.getElementById("cardList") ?? document.createElement("div");
const fahrtartFilter = document.getElementById("fahrtartFilter");
const csvExportBtn   = document.getElementById("csvExportYear");

let aktuelleFahrten = [];
let jahresansicht   = false;
let vehicles      = [];
let vehicleById   = new Map();

// ----------------- Fahrzeuge (Namen im Änderungsprotokoll) -----------------
// Angezeigt werden nur Fahrten des aktiven Fahrzeugs (siehe fahrzeug.js).
async function ladeVehicles() {
  await Promise.all([fahrzeugBereit, ersteSynchronisierung]);
  vehicles    = alleFahrzeuge;
  vehicleById = new Map(vehicles.map(v => [v.id, v]));
}

// ----------------- Hilfsfunktion: ist gerade Mobile? -----------------
function isMobile() {
  return window.innerWidth < 768;
}

// ----------------- Jahre füllen -----------------
function fuelleJahre() {
  const aktuellesJahr = new Date().getFullYear();
  jahrSelect.innerHTML = "";
  for (let j = aktuellesJahr; j >= START_JAHR; j--) {
    jahrSelect.innerHTML += `<option value="${j}">${j}</option>`;
  }
}

// ----------------- Fahrten des Jahres laden (eine Abfrage) -----------------
// Liefert alle Fahrten des gewählten Jahres inkl. Strecke; Monate werden lokal gefiltert
let jahresFahrten = [];

async function ladeJahr() {
  const res = await apiFetch(mitFahrzeug(`/api/fahrten?year=${jahrSelect.value}`));
  if (!res.ok) throw new Error(await apiError(res));
  jahresFahrten = (await res.json()).fahrten;
}

// ----------------- Monate füllen & aktuellen Monat vorauswählen -----------------
async function fuelleMonateMitCheck() {
  const jahr           = jahrSelect.value;
  const aktuellesJahr  = new Date().getFullYear();
  const aktuellerMonat = String(new Date().getMonth() + 1).padStart(2, "0");

  setLaden();
  try {
    await ladeJahr();
  } catch {
    setLeer("Fehler beim Laden");
    return;
  }

  const monateMitDaten = new Set(jahresFahrten.map(f => f.monat.slice(5)));
  const monatsname = mm => new Date(2000, Number(mm) - 1, 1).toLocaleString("de-DE", { month: "short" });
  monatSelect.innerHTML = `<option value="alle">Alle</option>` +
    Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))
      .map(mm => `<option value="${mm}" ${monateMitDaten.has(mm) ? "" : "disabled"}>${monatsname(mm)}</option>`)
      .join("");

  // Aktuelles Jahr → aktuellen Monat bevorzugen, sonst den ersten mit Daten
  const aktiverMonat = String(jahr) === String(aktuellesJahr) && monateMitDaten.has(aktuellerMonat)
    ? aktuellerMonat
    : [...monateMitDaten].sort()[0];

  if (aktiverMonat) {
    monatSelect.value = aktiverMonat;
    zeigeAuswahl();
  } else {
    aktuelleFahrten = [];
    setLeer("Keine Daten für dieses Jahr");
  }
}

// ----------------- Gewählten Monat (oder alle) aus den Jahresdaten anzeigen -----------------
function zeigeAuswahl() {
  const monat = monatSelect.value;
  jahresansicht   = monat === "alle";
  aktuelleFahrten = jahresansicht
    ? [...jahresFahrten]
    : jahresFahrten.filter(f => f.monat === `${jahrSelect.value}-${monat}`);

  if (aktuelleFahrten.length === 0) {
    setLeer(jahresansicht ? `Keine Daten für ${jahrSelect.value} vorhanden` : "Keine Daten vorhanden");
    return;
  }
  renderAll();
}

// ----------------- Fahrten neu vom Server laden (Auswahl bleibt) -----------------
async function ladeFahrten() {
  if (!jahrSelect.value || !monatSelect.value) return;
  try {
    await ladeJahr();
  } catch {
    setLeer("Fehler beim Laden");
    return;
  }
  zeigeAuswahl();
}

// ----------------- Render-Dispatcher -----------------
function renderAll() {
  renderSumme();
  if (jahresansicht) {
    renderTabelleJahresansicht();
    renderCardsJahresansicht();
  } else {
    renderTabelle();
    renderCards();
  }
}

// ═══════════════════════════════════════════════
// DESKTOP: Tabellen-Rendering
// ═══════════════════════════════════════════════

function renderTabelle() {
  tbody.innerHTML = "";
  const filter = fahrtartFilter.value;

  aktuelleFahrten.forEach((f, i) => {
    if (filter !== "alle" && f.fahrtart !== filter) return;
    const diff = f.strecke ?? 0;

    const tr = document.createElement("tr");
    tr.dataset.index = i;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td contenteditable="true" data-field="kmstand">${escapeHtml(f.kmstand)}</td>
      <td>${diff}</td>
      <td contenteditable="true" data-field="ziel">${escapeHtml(f.ziel)}</td>
      <td>
        <select class="form-select form-select-sm fahrtart-select" data-index="${i}">
          ${fahrtartOptionen(f.fahrtart)}
        </select>
      </td>
      <td>
        <input type="datetime-local" class="form-control form-control-sm timestamp-input"
          data-index="${i}" value="${toDatetimeLocal(f.timestamp)}">
      </td>
      <td class="text-center text-nowrap">
        ${historyButton(f)}
        <button class="btn btn-sm btn-outline-danger delete-btn" data-index="${i}" title="Löschen">
          <span class="mdi mdi-delete"></span>
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderTabelleJahresansicht() {
  tbody.innerHTML = "";
  const filter = fahrtartFilter.value;
  let laufenderMonat = null;
  let nr = 0;

  aktuelleFahrten.forEach((f, i) => {
    if (filter !== "alle" && f.fahrtart !== filter) return;
    const monat = monthKeyFromISO(f.timestamp);

    if (monat !== laufenderMonat) {
      laufenderMonat = monat;
      nr = 0;
      const trH = document.createElement("tr");
      trH.className = "table-dark";
      trH.innerHTML = `<td colspan="7" class="fw-bold small">
        <span class="mdi mdi-calendar-month me-1"></span>${formatMonat(monat)}
      </td>`;
      tbody.appendChild(trH);
    }

    nr++;
    const diff = f.strecke ?? 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${nr}</td>
      <td>${escapeHtml(f.kmstand)}</td>
      <td>${diff >= 0 ? diff : "–"}</td>
      <td>${escapeHtml(f.ziel)}</td>
      <td>${fahrtartBadge(f.fahrtart)}</td>
      <td>${new Date(f.timestamp).toLocaleString("de-DE")}</td>
      <td class="text-center">${historyButton(f)}</td>`;
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════
// MOBILE: Card-Rendering
// ═══════════════════════════════════════════════

function renderCards() {
  cardList.innerHTML = "";
  const filter = fahrtartFilter.value;

  aktuelleFahrten.forEach((f, i) => {
    if (filter !== "alle" && f.fahrtart !== filter) return;
    const diff = f.strecke ?? 0;
    cardList.appendChild(buildCard(f, i, diff, false));
  });
}

function renderCardsJahresansicht() {
  cardList.innerHTML = "";
  const filter = fahrtartFilter.value;
  let laufenderMonat = null;
  let nr = 0;

  aktuelleFahrten.forEach((f, i) => {
    if (filter !== "alle" && f.fahrtart !== filter) return;
    const monat = monthKeyFromISO(f.timestamp);

    if (monat !== laufenderMonat) {
      laufenderMonat = monat;
      nr = 0;
      const div = document.createElement("div");
      div.className = "month-divider";
      div.innerHTML = `<span class="mdi mdi-calendar-month me-1"></span>${formatMonat(monat)}`;
      cardList.appendChild(div);
    }

    nr++;
    const diff = f.strecke ?? 0;
    cardList.appendChild(buildCard(f, i, diff, true, nr));
  });
}

function buildCard(f, i, diff, readonly, nr) {
  const zeitpunkt = new Date(f.timestamp).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  const strecke   = f.strecke == null ? "" : `+${zahl(Math.max(diff, 0))} km`;

  const div = document.createElement("div");
  div.className = "fahrt-card";
  div.dataset.index = i;
  div.style.setProperty("--fahrtart-farbe", fahrtartInfo(f.fahrtart).chart);

  if (readonly) {
    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-center gap-2">
        <span class="card-meta">${escapeHtml(zeitpunkt)}</span>
        ${fahrtartBadge(f.fahrtart)}
      </div>
      <div class="d-flex align-items-baseline gap-2 mt-1">
        <span class="card-km">${zahl(f.kmstand)} km</span>
        <span class="strecke">${strecke}</span>
      </div>
      <div class="card-ziel">${escapeHtml(f.ziel)}</div>
      <div class="d-flex justify-content-between align-items-center mt-1">
        <span class="card-meta">#${nr ?? i + 1}</span>${historyButton(f)}
      </div>`;
  } else {
    div.innerHTML = `
      <div class="d-flex align-items-center gap-2 mb-2">
        <input type="datetime-local" class="form-control card-timestamp" aria-label="Zeitpunkt"
          data-index="${i}" value="${toDatetimeLocal(f.timestamp)}">
        <button class="btn btn-outline-danger btn-icon delete-btn" data-index="${i}" title="Fahrt löschen" aria-label="Fahrt löschen">
          <span class="mdi mdi-delete"></span>
        </button>
      </div>

      <div class="d-flex align-items-center gap-2 mb-2">
        <div class="input-group km-feld">
          <input type="number" inputmode="numeric" class="form-control card-field-km" aria-label="km-Stand"
            data-index="${i}" data-field="kmstand" value="${escapeHtml(f.kmstand)}">
          <span class="input-group-text">km</span>
        </div>
        <span class="strecke">${strecke}</span>
      </div>

      <input type="text" class="form-control mb-2 card-field-ziel" aria-label="Ziel / Kunde"
        data-index="${i}" data-field="ziel" value="${escapeHtml(f.ziel)}">

      <div class="d-flex align-items-center gap-2">
        <select class="form-select card-fahrtart" data-index="${i}" aria-label="Fahrtart">
          ${fahrtartOptionen(f.fahrtart)}
        </select>
        <span class="card-meta">#${i + 1}</span>${historyButton(f)}
      </div>`;
  }

  return div;
}

// ----------------- Summe der angezeigten Fahrten -----------------
function renderSumme() {
  const box = document.getElementById("auswahlSumme");
  const filter = fahrtartFilter.value;
  const fahrten = aktuelleFahrten.filter(f => filter === "alle" || f.fahrtart === filter);
  box.classList.toggle("d-none", fahrten.length === 0);
  if (fahrten.length === 0) return;

  const summe = Object.fromEntries(FAHRTARTEN.map(a => [a.key, 0]));
  for (const f of fahrten) summe[fahrtartInfo(f.fahrtart).key] += Math.max(f.strecke ?? 0, 0);
  const gesamt = FAHRTARTEN.reduce((n, a) => n + summe[a.key], 0);

  document.getElementById("auswahlTitel").textContent = jahresansicht
    ? `Jahr ${jahrSelect.value}`
    : formatMonat(`${jahrSelect.value}-${monatSelect.value}`);
  document.getElementById("auswahlKm").textContent      = kmText(gesamt);
  document.getElementById("auswahlFahrten").textContent = `· ${fahrten.length} Fahrt${fahrten.length === 1 ? "" : "en"}`;
  document.getElementById("auswahlBalken").innerHTML    = aufteilungsBalken(summe, { hoehe: 8 });
  document.getElementById("auswahlLegende").innerHTML   = FAHRTARTEN.map(a => `
    <span class="text-nowrap"><span class="d-inline-block rounded-1 me-1" style="width:8px;height:8px;background:${a.chart}"></span>${a.label} ${zahl(summe[a.key])} km</span>`).join("");
}

// ═══════════════════════════════════════════════
// Card-Events (Mobile)
// ═══════════════════════════════════════════════

cardList.addEventListener("change", async e => {
  if (jahresansicht) return;

  // Fahrtart-Dropdown
  if (e.target.classList.contains("card-fahrtart")) {
    const i = e.target.dataset.index;
    aktuelleFahrten[i].fahrtart = e.target.value;
    e.target.closest(".fahrt-card").style.setProperty("--fahrtart-farbe", fahrtartInfo(e.target.value).chart);
    if (await speichereFahrt(i)) renderSumme();
  }

  // Zeitpunkt
  if (e.target.classList.contains("card-timestamp")) {
    const i = e.target.dataset.index;
    const localVal = e.target.value;
    if (!localVal) return;
    await handleTimestampChange(i, localVal);
  }
});

cardList.addEventListener("blur", async e => {
  if (jahresansicht) return;

  if (e.target.classList.contains("card-field-km")) {
    const i = e.target.dataset.index;
    aktuelleFahrten[i].kmstand = Number(e.target.value);
    await speichereFahrt(i);
  }

  if (e.target.classList.contains("card-field-ziel")) {
    const i = e.target.dataset.index;
    aktuelleFahrten[i].ziel = e.target.value;
    await speichereFahrt(i);
  }
}, true);

// Verlauf-Buttons funktionieren auch in der (sonst schreibgeschützten) Jahresansicht
[cardList, tbody].forEach(el => el.addEventListener("click", e => {
  const btn = e.target.closest(".history-btn");
  if (btn) zeigeVerlauf(btn.dataset.id);
}));

cardList.addEventListener("click", e => {
  if (jahresansicht) return;
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  zeigeLoeschModal(btn.dataset.index);
});

// ═══════════════════════════════════════════════
// Tabellen-Events (Desktop)
// ═══════════════════════════════════════════════

tbody.addEventListener("blur", async e => {
  if (jahresansicht) return;
  if (!e.target.dataset.field) return;
  const tr    = e.target.closest("tr");
  const index = tr.dataset.index;
  const field = e.target.dataset.field;
  aktuelleFahrten[index][field] =
    field === "kmstand" ? Number(e.target.innerText) : e.target.innerText;
  await speichereFahrt(index);
}, true);

tbody.addEventListener("change", async e => {
  if (jahresansicht) return;

  if (e.target.classList.contains("fahrtart-select")) {
    const i = e.target.dataset.index;
    aktuelleFahrten[i].fahrtart = e.target.value;
    if (await speichereFahrt(i)) renderSumme();
  }

  if (e.target.classList.contains("timestamp-input")) {
    const i = e.target.dataset.index;
    if (!e.target.value) return;
    await handleTimestampChange(i, e.target.value);
  }
});

tbody.addEventListener("click", e => {
  if (jahresansicht) return;
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  zeigeLoeschModal(btn.dataset.index);
});

// ═══════════════════════════════════════════════
// Shared Logic
// ═══════════════════════════════════════════════

async function handleTimestampChange(index, localVal) {
  const alterMonthKey  = `${jahrSelect.value}-${monatSelect.value}`;
  const neuesTimestamp = new Date(localVal).toISOString();
  const neuerMonthKey  = monthKeyFromISO(neuesTimestamp);
  if (!neuerMonthKey) return;

  const gespeichert = await speichereFahrt(index, { timestamp: neuesTimestamp });
  if (!gespeichert) return;

  aktuelleFahrten[index].timestamp = neuesTimestamp;
  if (neuerMonthKey !== alterMonthKey) {
    // Fahrt gehört jetzt zu einem anderen Monat → Jahresdaten und Strecken neu laden
    await ladeFahrten();
    zeigeHinweis(`Fahrt wurde nach ${neuerMonthKey} verschoben.`, "info");
  }
}

// Speichert Änderungen einer Fahrt per ID. Ohne `aenderungen` werden
// die bearbeitbaren Felder aus aktuelleFahrten[index] gesendet.
async function speichereFahrt(index, aenderungen) {
  const fahrt = aktuelleFahrten[index];
  const body  = aenderungen ?? {
    kmstand:  fahrt.kmstand,
    ziel:     fahrt.ziel,
    fahrtart: fahrt.fahrtart,
  };

  try {
    let res = await apiFetch(`/api/fahrt/${fahrt._id}`, { method: "PUT", body });

    // km-Stand passt nicht zu den Nachbarfahrten → nachfragen und ggf. erzwingen
    if (res.status === 409) {
      const err = await res.json().catch(() => ({}));
      if (err.code === "KM_PLAUSIBILITY" && confirm(`${err.error}\n\nTrotzdem speichern?`)) {
        res = await apiFetch(`/api/fahrt/${fahrt._id}`, { method: "PUT", body: { ...body, force: true } });
      } else {
        zeigeHinweis(`Nicht gespeichert: ${err.error || res.status}`, "warning");
        ladeFahrten();  // Anzeige auf gespeicherten Stand zurücksetzen
        return false;
      }
    }

    if (!res.ok) {
      zeigeHinweis(`Fehler beim Speichern: ${await apiError(res)}`, "danger");
      return false;
    }
    fahrt.edited = true;
    return true;
  } catch (err) {
    console.error("Speicherfehler:", err);
    zeigeHinweis("Fehler beim Speichern.", "danger");
    return false;
  }
}

function zeigeLoeschModal(index) {
  const fahrt    = aktuelleFahrten[index];
  const zeitpunkt = new Date(fahrt.timestamp).toLocaleString("de-DE");

  document.getElementById("confirmDeleteInfo").textContent =
    `#${parseInt(index) + 1} · ${fahrt.kmstand} km · ${fahrt.ziel} · ${fahrt.fahrtart} · ${zeitpunkt}`;
  document.getElementById("confirmDeleteIndex").value = index;

  new bootstrap.Modal(document.getElementById("deleteModal")).show();
}

document.getElementById("confirmDeleteBtn")?.addEventListener("click", async () => {
  const index = document.getElementById("confirmDeleteIndex").value;
  const fahrt = aktuelleFahrten[index];

  try {
    const res = await apiFetch(`/api/fahrt/${fahrt._id}`, { method: "DELETE" });
    if (res.ok) {
      bootstrap.Modal.getInstance(document.getElementById("deleteModal")).hide();
      await ladeFahrten();  // Strecke der Folgefahrt ändert sich mit
    } else {
      alert("Fehler beim Löschen!");
    }
  } catch (err) {
    alert("Fehler beim Löschen!");
  }
});

// ═══════════════════════════════════════════════
// Hilfsfunktionen
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

function formatMonat(monthKey) {
  if (!monthKey) return monthKey;
  const [y, m] = monthKey.split("-");
  return new Date(y, parseInt(m) - 1).toLocaleString("de-DE", { month: "long", year: "numeric" });
}

function setLaden(text = "Lade Daten...") {
  tbody.innerHTML   = `<tr><td colspan="7">${escapeHtml(text)}</td></tr>`;
  cardList.innerHTML = `<p class="text-muted small">${escapeHtml(text)}</p>`;
}

function setLeer(text) {
  document.getElementById("auswahlSumme").classList.add("d-none");
  tbody.innerHTML   = `<tr><td colspan="7">${escapeHtml(text)}</td></tr>`;
  cardList.innerHTML = `<p class="text-muted small">${escapeHtml(text)}</p>`;
}

function zeigeHinweis(text, typ = "info") {
  let container = document.getElementById("hinweisContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "hinweisContainer";
    container.style.cssText = "position:fixed;top:1rem;right:1rem;z-index:9999;min-width:280px;";
    document.body.appendChild(container);
  }
  const div = document.createElement("div");
  div.className = `alert alert-${typ} alert-dismissible fade show shadow`;
  div.innerHTML = `${escapeHtml(text)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

// ═══════════════════════════════════════════════
// Filter & Export & Swipe
// ═══════════════════════════════════════════════

fahrtartFilter.addEventListener("change", renderAll);

csvExportBtn?.addEventListener("click", () => {
  downloadDatei(mitFahrzeug(`/api/export/csv/year/${jahrSelect.value}`), `fahrten_${jahrSelect.value}.csv`);
});

document.getElementById("pdfExportYear")?.addEventListener("click", () => {
  downloadDatei(mitFahrzeug(`/api/export/pdf/year/${jahrSelect.value}`), `fahrtenbuch_${jahrSelect.value}.pdf`);
});

let startX = 0;
const swipeTarget = document.body;
swipeTarget.addEventListener("touchstart", e => startX = e.touches[0].clientX);
swipeTarget.addEventListener("touchend", e => {
  if (jahresansicht) return;
  const diff = e.changedTouches[0].clientX - startX;
  if (Math.abs(diff) < 60) return;
  const opts = [...monatSelect.options].filter(o => o.value !== "alle" && !o.disabled);
  if (opts.length === 0) return;
  const curIdx = opts.findIndex(o => o.value === monatSelect.value);
  if (diff < 0 && curIdx < opts.length - 1) monatSelect.value = opts[curIdx + 1].value;
  if (diff > 0 && curIdx > 0)               monatSelect.value = opts[curIdx - 1].value;
  zeigeAuswahl();
});

// ═══════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════

jahrSelect.addEventListener("change", fuelleMonateMitCheck);
monatSelect.addEventListener("change", zeigeAuswahl);

// ═══════════════════════════════════════════════
// Änderungsprotokoll
// ═══════════════════════════════════════════════

function historyButton(f) {
  if (!f.edited) return "";
  return `<button class="btn btn-sm btn-outline-secondary history-btn" data-id="${escapeHtml(f._id)}"
            title="Nachträglich geändert – Verlauf anzeigen">
            <span class="mdi mdi-history"></span>
          </button>`;
}

const FELD_LABELS = { kmstand: "km-Stand", ziel: "Ziel", fahrtart: "Fahrtart", timestamp: "Zeitpunkt", vehicle_id: "Fahrzeug" };
const AKTIONEN    = { create: "Angelegt", update: "Geändert", delete: "Gelöscht" };
const QUELLEN     = { web: "Web", api_token: "API-Token", admin: "Admin" };
const quelleText  = quelle => QUELLEN[quelle] || quelle;

function formatWert(feld, wert) {
  if (wert == null) return "–";
  if (feld === "timestamp")   return new Date(wert).toLocaleString("de-DE");
  if (feld === "kmstand")     return `${wert} km`;
  if (feld === "vehicle_id")  return vehicleById.get(wert)?.name ?? `Fahrzeug #${wert}`;
  return String(wert);
}

// Beschreibt einen Protokolleintrag als HTML (Werte werden maskiert)
function beschreibeEintrag(e) {
  if (e.action === "update") {
    const zeilen = Object.keys(FELD_LABELS)
      .filter(f => JSON.stringify(e.old_data?.[f]) !== JSON.stringify(e.new_data?.[f]))
      .map(f => `${FELD_LABELS[f]}: <del>${escapeHtml(formatWert(f, e.old_data?.[f]))}</del>
                 → <strong>${escapeHtml(formatWert(f, e.new_data?.[f]))}</strong>`);
    return zeilen.length ? zeilen.join("<br>") : "Gespeichert ohne inhaltliche Änderung";
  }
  const d = e.action === "delete" ? e.old_data : e.new_data;
  return escapeHtml(`${formatWert("timestamp", d.timestamp)} · ${formatWert("kmstand", d.kmstand)} · ${d.fahrtart} · ${d.ziel}`);
}

function zeigeProtokoll(titel, eintraege, leerText) {
  document.getElementById("auditModalLabel").textContent = titel;
  document.getElementById("auditModalBody").innerHTML = eintraege.length === 0
    ? `<p class="text-muted mb-0">${escapeHtml(leerText)}</p>`
    : `<ul class="list-group list-group-flush">${eintraege.map(e => `
        <li class="list-group-item px-0">
          <div class="d-flex justify-content-between small text-muted mb-1">
            <span>${escapeHtml(new Date(e.changed_at).toLocaleString("de-DE"))} · ${escapeHtml(quelleText(e.source))}</span>
            <span>${e.fahrt_id ? `Fahrt-ID ${escapeHtml(e.fahrt_id)} · ` : ""}${escapeHtml(AKTIONEN[e.action] || e.action)}</span>
          </div>
          <div class="small">${beschreibeEintrag(e)}</div>
        </li>`).join("")}</ul>`;
  bootstrap.Modal.getOrCreateInstance(document.getElementById("auditModal")).show();
}

async function zeigeVerlauf(id) {
  const res = await apiFetch(`/api/fahrt/${id}/history`);
  if (!res.ok) return zeigeHinweis(await apiError(res), "danger");
  zeigeProtokoll("Änderungsverlauf der Fahrt", await res.json(), "Keine Einträge.");
}

document.getElementById("auditYear")?.addEventListener("click", async () => {
  const jahr = jahrSelect.value;
  const res  = await apiFetch(mitFahrzeug(`/api/audit?year=${jahr}`));
  if (!res.ok) return zeigeHinweis(await apiError(res), "danger");
  zeigeProtokoll(`Änderungsprotokoll ${jahr}`, await res.json(),
    `Keine nachträglichen Änderungen oder Löschungen in ${jahr}.`);
});

ladeVehicles().then(() => {
  fuelleJahre();
  fuelleMonateMitCheck();
  document.addEventListener("fahrtenNachgereicht", aktualisiereNachSync);
});

// Nach dem Nachreichen offline erfasster Fahrten neu laden – aber nicht mitten
// in einer Bearbeitung, sonst ginge die Eingabe verloren
function aktualisiereNachSync() {
  const bearbeitung = [tbody, cardList].some(el => el.contains(document.activeElement));
  if (bearbeitung) {
    document.activeElement.addEventListener("blur", () => setTimeout(aktualisiereNachSync, 500), { once: true });
    return;
  }
  // Leere Ansicht → Monatsliste neu prüfen (der Monat war evtl. noch deaktiviert)
  if (aktuelleFahrten.length === 0) fuelleMonateMitCheck();
  else ladeFahrten();
}

}); // DOMContentLoaded
