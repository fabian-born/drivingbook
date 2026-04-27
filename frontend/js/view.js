const jahrSelect = document.getElementById("jahrSelect");
const monatSelect = document.getElementById("monatSelect");
const tbody = document.getElementById("fahrtenTabelle");
const fahrtartFilter = document.getElementById("fahrtartFilter");
const csvExportBtn = document.getElementById("csvExportYear");

let aktuelleFahrten = [];

// ----------------- Jahre füllen -----------------
function fuelleJahre() {
  const aktuellesJahr = new Date().getFullYear();
  jahrSelect.innerHTML = "";
  for (let j = aktuellesJahr; j >= START_JAHR; j--) {
    jahrSelect.innerHTML += `<option value="${j}">${j}</option>`;
  }
}

// ----------------- Monate prüfen -----------------
async function fuelleMonateMitCheck() {
  const jahr = jahrSelect.value;
  monatSelect.innerHTML = "";
  let ersterAktiverMonat = null;

  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const monthKey = `${jahr}-${mm}`;
    const option = document.createElement("option");
    option.value = mm;
    option.textContent = mm;

    try {
      const res = await fetch(`${API_BASE_URL}/api/export/json?month=${monthKey}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` }
      });
      if (!res.ok) option.disabled = true;
      else if (!ersterAktiverMonat) ersterAktiverMonat = mm;
    } catch {
      option.disabled = true;
    }
    monatSelect.appendChild(option);
  }

  if (ersterAktiverMonat) {
    monatSelect.value = ersterAktiverMonat;
    ladeFahrten();
  } else {
    tbody.innerHTML = `<tr><td colspan="7">Keine Daten für dieses Jahr</td></tr>`;
  }
}

// ----------------- Fahrten laden -----------------
async function ladeFahrten() {
  const jahr = jahrSelect.value;
  const monat = monatSelect.value;
  if (!jahr || !monat) return;

  tbody.innerHTML = `<tr><td colspan="7">Lade Daten...</td></tr>`;
  const monthKey = `${jahr}-${monat}`;

  try {
    const res = await fetch(`${API_BASE_URL}/api/export/json?month=${monthKey}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` }
    });
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7">Keine Daten vorhanden</td></tr>`;
      aktuelleFahrten = [];
      return;
    }
    aktuelleFahrten = await res.json();
    renderTabelle();
  } catch {
    tbody.innerHTML = `<tr><td colspan="7">Fehler beim Laden</td></tr>`;
  }
}

// ----------------- Timestamp → datetime-local Format -----------------
function toDatetimeLocal(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ----------------- MonthKey aus ISO-Timestamp -----------------
function monthKeyFromISO(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ----------------- Tabelle rendern -----------------
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
      <td contenteditable="true" data-field="kmstand">${f.kmstand}</td>
      <td>${diff}</td>
      <td contenteditable="true" data-field="ziel">${f.ziel}</td>
      <td>
        <select class="form-select form-select-sm fahrtart-select" data-index="${i}">
          <option value="geschäftlich" ${f.fahrtart === "geschäftlich" ? "selected" : ""}>Geschäftlich</option>
          <option value="privat" ${f.fahrtart === "privat" ? "selected" : ""}>Privat</option>
        </select>
      </td>
      <td>
        <input
          type="datetime-local"
          class="form-control form-control-sm timestamp-input"
          data-index="${i}"
          value="${toDatetimeLocal(f.timestamp)}"
        >
      </td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-danger delete-btn" data-index="${i}" title="Fahrt löschen">
          <span class="mdi mdi-delete"></span>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// ----------------- Inline-Bearbeitung: KM Stand & Ziel (contenteditable) -----------------
tbody.addEventListener("blur", async e => {
  if (!e.target.dataset.field) return;
  const tr = e.target.closest("tr");
  const index = tr.dataset.index;
  const field = e.target.dataset.field;

  aktuelleFahrten[index][field] =
    field === "kmstand" ? Number(e.target.innerText) : e.target.innerText;

  await speichereFahrt(index);
}, true);

// ----------------- Fahrtart Dropdown & Zeitpunkt -----------------
tbody.addEventListener("change", async e => {
  if (e.target.classList.contains("fahrtart-select")) {
    const index = e.target.dataset.index;
    aktuelleFahrten[index].fahrtart = e.target.value;
    await speichereFahrt(index);
  }

  if (e.target.classList.contains("timestamp-input")) {
    const index = e.target.dataset.index;
    const localVal = e.target.value;
    if (!localVal) return;

    const alterMonthKey = `${jahrSelect.value}-${monatSelect.value}`;
    const neuesTimestamp = new Date(localVal).toISOString();
    const neuerMonthKey = monthKeyFromISO(neuesTimestamp);

    if (!neuerMonthKey) return;

    if (neuerMonthKey !== alterMonthKey) {
      // Monat hat sich geändert → Fahrt in andere JSON-Datei verschieben
      const fahrtMitNeuemTimestamp = { ...aktuelleFahrten[index], timestamp: neuesTimestamp };

      try {
        const res = await fetch(`${API_BASE_URL}/api/fahrt/move`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`
          },
          body: JSON.stringify({
            fromMonth: alterMonthKey,
            index: Number(index),
            fahrt: fahrtMitNeuemTimestamp
          })
        });

        if (res.ok) {
          aktuelleFahrten.splice(index, 1);
          renderTabelle();
          zeigeHinweis(`Fahrt wurde nach ${neuerMonthKey} verschoben.`, "info");
        } else {
          const err = await res.json();
          zeigeHinweis(`Fehler beim Verschieben: ${err.error}`, "danger");
        }
      } catch (err) {
        console.error("Fehler beim Verschieben:", err);
        zeigeHinweis("Fehler beim Verschieben der Fahrt.", "danger");
      }

    } else {
      // Gleicher Monat → normales Update
      aktuelleFahrten[index].timestamp = neuesTimestamp;
      await speichereFahrt(index);
    }
  }
});

// ----------------- Fahrt speichern (PUT) -----------------
async function speichereFahrt(index) {
  const monthKey = `${jahrSelect.value}-${monatSelect.value}`;
  try {
    const res = await fetch(`${API_BASE_URL}/api/fahrt/${monthKey}/${index}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("authToken")}`
      },
      body: JSON.stringify(aktuelleFahrten[index])
    });
    if (!res.ok) {
      zeigeHinweis("Fehler beim Speichern.", "danger");
    }
  } catch (err) {
    console.error("Speicherfehler:", err);
  }
}

// ----------------- Löschen mit Bestätigung -----------------
tbody.addEventListener("click", async e => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;

  const index = btn.dataset.index;
  const fahrt = aktuelleFahrten[index];
  const zeitpunkt = new Date(fahrt.timestamp).toLocaleString("de-DE");

  document.getElementById("confirmDeleteInfo").textContent =
    `#${parseInt(index) + 1} · ${fahrt.kmstand} km · ${fahrt.ziel} · ${fahrt.fahrtart} · ${zeitpunkt}`;
  document.getElementById("confirmDeleteIndex").value = index;

  const modal = new bootstrap.Modal(document.getElementById("deleteModal"));
  modal.show();
});

document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
  const index = document.getElementById("confirmDeleteIndex").value;
  const monthKey = `${jahrSelect.value}-${monatSelect.value}`;

  try {
    const res = await fetch(`${API_BASE_URL}/api/fahrt/${monthKey}/${index}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` }
    });

    if (res.ok) {
      aktuelleFahrten.splice(index, 1);
      bootstrap.Modal.getInstance(document.getElementById("deleteModal")).hide();
      renderTabelle();
    } else {
      alert("Fehler beim Löschen!");
    }
  } catch (err) {
    console.error("Löschfehler:", err);
    alert("Fehler beim Löschen!");
  }
});

// ----------------- Toast-Hinweis -----------------
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
  div.innerHTML = `${text}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

// ----------------- Filter -----------------
fahrtartFilter.addEventListener("change", renderTabelle);

// ----------------- CSV Export -----------------
csvExportBtn?.addEventListener("click", () => {
  const jahr = jahrSelect.value;
  window.location.href = `${API_BASE_URL}/api/export/csv/year/${jahr}`;
});

// ----------------- Swipe Gesten -----------------
let startX = 0;
tbody.addEventListener("touchstart", e => startX = e.touches[0].clientX);
tbody.addEventListener("touchend", e => {
  const diff = e.changedTouches[0].clientX - startX;
  if (Math.abs(diff) < 50) return;
  let idx = monatSelect.selectedIndex;
  if (diff < 0 && idx < monatSelect.options.length - 1) idx++;
  if (diff > 0 && idx > 0) idx--;
  monatSelect.selectedIndex = idx;
  ladeFahrten();
});

// ----------------- Events -----------------
jahrSelect.addEventListener("change", fuelleMonateMitCheck);
monatSelect.addEventListener("change", ladeFahrten);

// ----------------- Init -----------------
fuelleJahre();
fuelleMonateMitCheck();
