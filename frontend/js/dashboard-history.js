// js/dashboard-history.js
// Jahreshistorie: Auswertung abgeschlossener Jahre für das aktive Fahrzeug (siehe auswertung.js)

let chartInstanzHistory = null;

async function ladeHistoryDashboard(jahr) {
  const ziel = document.getElementById("historyContent");
  document.getElementById("printHeadline").textContent = `Fahrtenbuch – Jahreshistorie ${jahr}`;
  await Promise.all([fahrzeugBereit, ersteSynchronisierung]);

  let daten = { monate: [], summe: { gesamt: 0, fahrten: 0 } };
  try {
    const res = await apiFetch(mitFahrzeug(`/api/fahrten?year=${jahr}`));
    if (!res.ok) throw new Error(await apiError(res));
    daten = await res.json();
  } catch (err) {
    ziel.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
    return;
  }

  const { monate, summe } = daten;
  chartInstanzHistory = zeigeJahresauswertung(ziel, {
    jahr, monate, summe, alterChart: chartInstanzHistory,
    kacheln: [
      { label: `Gesamt ${jahr}`, wert: kmText(summe.gesamt), hinweis: `${zahl(summe.fahrten)} Fahrten` },
      { label: "Ø pro Monat", wert: kmText(monate.length ? Math.round(summe.gesamt / monate.length) : 0) },
      { label: "Aktive Monate", wert: `${monate.length} / 12` },
    ],
  });
}

// Drucken: Diagramm als Bild einsetzen, damit es im Druck erscheint
function druckeSeite() {
  const canvas = document.querySelector("#historyContent canvas");
  const bild   = document.querySelector("#historyContent .verlauf-druckbild");
  if (canvas && bild) bild.src = canvas.toDataURL("image/png");
  window.print();
}

function initHistory() {
  const jahrSelect    = document.getElementById("historyJahrSelect");
  const aktuellesJahr = new Date().getFullYear();

  for (let j = aktuellesJahr - 1; j >= START_JAHR; j--) {
    jahrSelect.insertAdjacentHTML("beforeend", `<option value="${j}">${j}</option>`);
  }

  document.getElementById("historyCSVExport").addEventListener("click", () => {
    downloadDatei(mitFahrzeug(`/api/export/csv/year/${jahrSelect.value}`), `fahrten_${jahrSelect.value}.csv`);
  });
  document.getElementById("historyPDFExport").addEventListener("click", druckeSeite);
  jahrSelect.addEventListener("change", () => ladeHistoryDashboard(jahrSelect.value));

  ersteSynchronisierung.then(() => document.addEventListener("fahrtenNachgereicht", () => {
    if (jahrSelect.value) ladeHistoryDashboard(jahrSelect.value);
  }));

  if (jahrSelect.options.length > 0) {
    ladeHistoryDashboard(jahrSelect.value);
  } else {
    document.getElementById("historyContent").innerHTML = `
      <div class="alert alert-warning">Keine vergangenen Jahre verfügbar (START_JAHR = ${START_JAHR}).</div>`;
  }
}

document.addEventListener("DOMContentLoaded", initHistory);
