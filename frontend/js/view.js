document.addEventListener("DOMContentLoaded", () => {

const jahrSelect  = document.getElementById("jahrSelect");
const monatSelect = document.getElementById("monatSelect");
const tbody       = document.getElementById("fahrtenTabelle");
const cardList    = document.getElementById("cardList") ?? document.createElement("div");
const fahrtartFilter = document.getElementById("fahrtartFilter");
const csvExportBtn   = document.getElementById("csvExportYear");

let aktuelleFahrten = [];
let jahresansicht   = false;

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

// ----------------- Monate prüfen & aktuellen Monat vorauswählen -----------------
async function fuelleMonateMitCheck() {
  const jahr         = jahrSelect.value;
  const aktuellesJahr  = new Date().getFullYear();
  const aktuellerMonat = String(new Date().getMonth() + 1).padStart(2, "0");
  monatSelect.innerHTML = "";

  // "Alle Monate" Option ganz oben
  const alleOption = document.createElement("option");
  alleOption.value = "alle";
  alleOption.textContent = "Alle Monate";
  monatSelect.appendChild(alleOption);

  let aktiverMonat = null;

  for (let m = 1; m <= 12; m++) {
    const mm       = String(m).padStart(2, "0");
    const monthKey = `${jahr}-${mm}`;
    const option   = document.createElement("option");
    option.value   = mm;
    option.textContent = mm;

    try {
      const res = await apiFetch(`/api/export/json?month=${monthKey}`);
      if (!res.ok) {
        option.disabled = true;
      } else {
        // Aktuelles Jahr → aktuellen Monat bevorzugen
        if (String(jahr) === String(aktuellesJahr) && mm === aktuellerMonat) {
          aktiverMonat = mm;
        } else if (!aktiverMonat) {
          aktiverMonat = mm;
        }
      }
    } catch {
      option.disabled = true;
    }
    monatSelect.appendChild(option);
  }

  if (aktiverMonat) {
    monatSelect.value = aktiverMonat;
    jahresansicht = false;
    ladeFahrten();
  } else {
    setLeer("Keine Daten für dieses Jahr");
  }
}

// ----------------- Fahrten laden -----------------
async function ladeFahrten() {
  const jahr  = jahrSelect.value;
  const monat = monatSelect.value;
  if (!jahr || !monat) return;

  if (monat === "alle") {
    jahresansicht = true;
    await ladeAlleMonateDesJahres(jahr);
    return;
  }

  jahresansicht = false;
  setLaden();
  const monthKey = `${jahr}-${monat}`;

  try {
    const res = await apiFetch(`/api/export/json?month=${monthKey}`);
    if (!res.ok) {
      setLeer("Keine Daten vorhanden");
      aktuelleFahrten = [];
      return;
    }
    aktuelleFahrten = await res.json();
    renderAll();
  } catch {
    setLeer("Fehler beim Laden");
  }
}

// ----------------- Alle Monate des Jahres laden -----------------
async function ladeAlleMonateDesJahres(jahr) {
  setLaden("Lade Jahresdaten...");
  aktuelleFahrten = [];

  for (let m = 1; m <= 12; m++) {
    const monthKey = `${jahr}-${String(m).padStart(2, "0")}`;
    try {
      const res = await apiFetch(`/api/export/json?month=${monthKey}`);
      if (!res.ok) continue;
      aktuelleFahrten.push(...(await res.json()));
    } catch { /* Monat überspringen */ }
  }

  if (aktuelleFahrten.length === 0) {
    setLeer(`Keine Daten für ${jahr} vorhanden`);
    return;
  }
  renderAll();
}

// ----------------- Render-Dispatcher -----------------
function renderAll() {
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
    const diff = i === 0 ? 0 : f.kmstand - aktuelleFahrten[i - 1].kmstand;

    const tr = document.createElement("tr");
    tr.dataset.index = i;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td contenteditable="true" data-field="kmstand">${escapeHtml(f.kmstand)}</td>
      <td>${diff}</td>
      <td contenteditable="true" data-field="ziel">${escapeHtml(f.ziel)}</td>
      <td>
        <select class="form-select form-select-sm fahrtart-select" data-index="${i}">
          <option value="geschäftlich" ${f.fahrtart === "geschäftlich" ? "selected" : ""}>Geschäftlich</option>
          <option value="privat"       ${f.fahrtart === "privat"       ? "selected" : ""}>Privat</option>
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
    const diff = i === 0 ? 0 : f.kmstand - aktuelleFahrten[i - 1].kmstand;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${nr}</td>
      <td>${escapeHtml(f.kmstand)}</td>
      <td>${diff >= 0 ? diff : "–"}</td>
      <td>${escapeHtml(f.ziel)}</td>
      <td><span class="badge ${f.fahrtart === 'privat' ? 'bg-success' : 'bg-primary'} card-badge">${escapeHtml(f.fahrtart)}</span></td>
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
    const diff = i === 0 ? 0 : f.kmstand - aktuelleFahrten[i - 1].kmstand;
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
    const diff = i === 0 ? 0 : f.kmstand - aktuelleFahrten[i - 1].kmstand;
    cardList.appendChild(buildCard(f, i, diff, true, nr));
  });
}

function buildCard(f, i, diff, readonly, nr) {
  const badge   = f.fahrtart === "privat"
    ? `<span class="badge bg-success card-badge">Privat</span>`
    : `<span class="badge bg-primary card-badge">Geschäftlich</span>`;
  const zeitpunkt = new Date(f.timestamp).toLocaleString("de-DE");
  const num = nr ?? (i + 1);

  const div = document.createElement("div");
  div.className = "fahrt-card";
  div.dataset.index = i;

  if (readonly) {
    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <span class="card-km">${escapeHtml(f.kmstand)} km</span>
          <span class="card-diff ms-2">+${diff >= 0 ? diff : 0} km</span>
        </div>
        ${badge}
      </div>
      <div class="card-ziel">${escapeHtml(f.ziel)}</div>
      <div class="card-meta">#${num} · ${zeitpunkt} ${historyButton(f)}</div>`;
  } else {
    div.innerHTML = `
      <button class="btn btn-sm btn-outline-danger delete-btn btn-delete-card" data-index="${i}" title="Löschen">
        <span class="mdi mdi-delete"></span>
      </button>

      <div class="d-flex align-items-center gap-2 mb-2">
        <input type="number" class="form-control form-control-sm card-field-km"
          data-index="${i}" data-field="kmstand" value="${escapeHtml(f.kmstand)}" style="width:110px">
        <span class="card-diff text-muted">+${diff >= 0 ? diff : 0} km</span>
        <select class="form-select form-select-sm ms-auto card-fahrtart" data-index="${i}" style="width:130px">
          <option value="geschäftlich" ${f.fahrtart === "geschäftlich" ? "selected" : ""}>Geschäftlich</option>
          <option value="privat"       ${f.fahrtart === "privat"       ? "selected" : ""}>Privat</option>
        </select>
      </div>

      <input type="text" class="form-control form-control-sm mb-2 card-field-ziel"
        data-index="${i}" data-field="ziel" value="${escapeHtml(f.ziel)}">

      <input type="datetime-local" class="form-control form-control-sm card-timestamp"
        data-index="${i}" value="${toDatetimeLocal(f.timestamp)}">

      <div class="card-meta mt-1">#${i + 1} ${historyButton(f)}</div>`;
  }

  return div;
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
    await speichereFahrt(i);
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
    await speichereFahrt(i);
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
    // Fahrt gehört jetzt zu einem anderen Monat → aus der Ansicht entfernen
    aktuelleFahrten.splice(index, 1);
    renderAll();
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
      aktuelleFahrten.splice(index, 1);
      bootstrap.Modal.getInstance(document.getElementById("deleteModal")).hide();
      renderAll();
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
  downloadDatei(`/api/export/csv/year/${jahrSelect.value}`, `fahrten_${jahrSelect.value}.csv`);
});

document.getElementById("pdfExportYear")?.addEventListener("click", () => {
  downloadDatei(`/api/export/pdf/year/${jahrSelect.value}`, `fahrtenbuch_${jahrSelect.value}.pdf`);
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
  ladeFahrten();
});

// ═══════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════

jahrSelect.addEventListener("change", fuelleMonateMitCheck);
monatSelect.addEventListener("change", ladeFahrten);

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

const FELD_LABELS = { kmstand: "km-Stand", ziel: "Ziel", fahrtart: "Fahrtart", timestamp: "Zeitpunkt", vehicle_id: "Fahrzeug-ID" };
const AKTIONEN    = { create: "Angelegt", update: "Geändert", delete: "Gelöscht" };
const QUELLEN     = { web: "Web", api_token: "API-Token" };

function formatWert(feld, wert) {
  if (wert == null) return "–";
  if (feld === "timestamp") return new Date(wert).toLocaleString("de-DE");
  if (feld === "kmstand")   return `${wert} km`;
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
            <span>${escapeHtml(new Date(e.changed_at).toLocaleString("de-DE"))} · ${escapeHtml(QUELLEN[e.source] || e.source)}</span>
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
  const res  = await apiFetch(`/api/audit?year=${jahr}`);
  if (!res.ok) return zeigeHinweis(await apiError(res), "danger");
  zeigeProtokoll(`Änderungsprotokoll ${jahr}`, await res.json(),
    `Keine nachträglichen Änderungen oder Löschungen in ${jahr}.`);
});

fuelleJahre();
fuelleMonateMitCheck();

}); // DOMContentLoaded
