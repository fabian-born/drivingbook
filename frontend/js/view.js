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
      const res = await fetch(`${API_BASE_URL}/api/export/json?month=${monthKey}`);
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
    tbody.innerHTML = `<tr><td colspan="6">Keine Daten für dieses Jahr</td></tr>`;
  }
}

// ----------------- Fahrten laden -----------------
async function ladeFahrten() {
  const jahr = jahrSelect.value;
  const monat = monatSelect.value;
  if (!jahr || !monat) return;

  tbody.innerHTML = `<tr><td colspan="6">Lade Daten...</td></tr>`;
  const monthKey = `${jahr}-${monat}`;

  try {
    const res = await fetch(`${API_BASE_URL}/api/export/json?month=${monthKey}`);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="6">Keine Daten vorhanden</td></tr>`;
      aktuelleFahrten = [];
      return;
    }
    aktuelleFahrten = await res.json();
    renderTabelle();
  } catch {
    tbody.innerHTML = `<tr><td colspan="6">Fehler beim Laden</td></tr>`;
  }
}

// ----------------- Tabelle rendern -----------------
function renderTabelle() {
  tbody.innerHTML = "";
  const filter = fahrtartFilter.value;

  aktuelleFahrten.forEach((f, i) => {
    if (filter !== "alle" && f.fahrtart !== filter) return;
    const diff = i === 0 ? 0 : f.kmstand - aktuelleFahrten[i - 1].kmstand;

    tbody.innerHTML += `
      <tr data-index="${i}">
        <td>${i + 1}</td>
        <td contenteditable="true" data-field="kmstand">${f.kmstand}</td>
        <td>${diff}</td>
        <td contenteditable="true" data-field="ziel">${f.ziel}</td>
        <td>${f.fahrtart}</td>
        <td>${new Date(f.timestamp).toLocaleString()}</td>
      </tr>
    `;
  });
}

// ----------------- Inline-Bearbeitung -----------------
tbody.addEventListener("blur", async e => {
  if (!e.target.dataset.field) return;
  const tr = e.target.closest("tr");
  const index = tr.dataset.index;
  const field = e.target.dataset.field;

  aktuelleFahrten[index][field] =
    field === "kmstand" ? Number(e.target.innerText) : e.target.innerText;

  const monthKey = `${jahrSelect.value}-${monatSelect.value}`;

  await fetch(`${API_BASE_URL}/api/fahrt/${monthKey}/${index}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(aktuelleFahrten[index])
  });
}, true);

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
