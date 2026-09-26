// js/dashboard-history.js
// Year history: analysis of completed years for the active vehicle (see auswertung.js)

let chartInstanzHistory = null;

async function ladeHistoryDashboard(jahr) {
  const ziel = document.getElementById("historyContent");
  document.getElementById("printHeadline").textContent = t("history.printHeadline", { year: jahr });
  await Promise.all([fahrzeugBereit, ersteSynchronisierung]);

  let daten = { months: [], totals: { total: 0, trips: 0 } };
  try {
    const res = await apiFetch(mitFahrzeug(`/api/trips?year=${jahr}`));
    if (!res.ok) throw new Error(await apiError(res));
    daten = await res.json();
  } catch (err) {
    ziel.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
    return;
  }

  const { months: monate, totals: summe } = daten;
  chartInstanzHistory = zeigeJahresauswertung(ziel, {
    jahr, monate, summe, alterChart: chartInstanzHistory,
    kacheln: [
      { label: t("history.total", { year: jahr }), wert: kmText(summe.total), hinweis: t("history.trips", { count: summe.trips, n: zahl(summe.trips) }) },
      { label: t("history.perMonth"), wert: kmText(monate.length ? Math.round(summe.total / monate.length) : 0) },
      { label: t("history.activeMonths"), wert: `${monate.length} / 12` },
    ],
  });
}

// Printing: insert the chart as an image so it shows up in print.
// "beforeprint" runs after theme.js (switch to light) – also on Ctrl+P.
window.addEventListener("beforeprint", () => {
  const canvas = document.querySelector("#historyContent canvas");
  const bild   = document.querySelector("#historyContent .verlauf-druckbild");
  if (canvas && bild) bild.src = canvas.toDataURL("image/png");
});

function druckeSeite() {
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

  ersteSynchronisierung.then(() => beiAktualisierung(() => {
    if (jahrSelect.value) return ladeHistoryDashboard(jahrSelect.value);
  }));

  if (jahrSelect.options.length > 0) {
    ladeHistoryDashboard(jahrSelect.value);
  } else {
    document.getElementById("historyContent").innerHTML = `
      <div class="alert alert-warning">${tHtml("history.noYears", { start: START_JAHR })}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", initHistory);
