// js/dashboard-history.js

let chartInstanzHistory = null;

async function ladeHistoryDashboard(jahr) {
  document.getElementById("historyLoading").classList.remove("d-none");
  document.getElementById("historyContent").classList.add("d-none");
  await Promise.all([fahrzeugBereit, ersteSynchronisierung]);

  // Eine Abfrage fürs ganze Jahr; Strecken rechnet das Backend (ab dem letzten km-Stand des Vorjahres)
  let monatsTabelle = [], summe = { gesamt: 0, privat: 0, geschaeftlich: 0, arbeitsweg: 0 };
  try {
    const res = await apiFetch(mitFahrzeug(`/api/fahrten?year=${jahr}`));
    if (res.ok) {
      const daten = await res.json();
      summe = daten.summe;
      monatsTabelle = daten.monate.map(m => ({
        month: m.monat, startKm: m.start_km, endKm: m.end_km,
        diff: m.gesamt, privat: m.privat, geschaeft: m.geschaeftlich, arbeitsweg: m.arbeitsweg,
      }));
    }
  } catch (e) {
    console.warn("Jahreshistorie:", e);
  }
  const gesamtKm       = summe.gesamt;
  const totalPrivat    = summe.privat;
  const totalGeschaeft = summe.geschaeftlich;
  const totalArbeitsweg = summe.arbeitsweg;

  document.getElementById("historyLoading").classList.add("d-none");
  document.getElementById("historyContent").classList.remove("d-none");

  if (monatsTabelle.length === 0) {
    document.getElementById("historyContent").innerHTML = `
      <div class="alert alert-info text-center mt-4">
        Keine Daten für das Jahr <strong>${jahr}</strong> vorhanden.
      </div>`;
    return;
  }

  const privatPct    = gesamtKm > 0 ? ((totalPrivat    / gesamtKm) * 100).toFixed(2) : "0.00";
  const geschaeftPct = gesamtKm > 0 ? ((totalGeschaeft / gesamtKm) * 100).toFixed(2) : "0.00";
  const arbeitswegPct = gesamtKm > 0 ? ((totalArbeitsweg / gesamtKm) * 100).toFixed(2) : "0.00";

  document.getElementById("historyContent").innerHTML = `
    <!-- Stat-Karten -->
    <div class="row mb-3" id="statCards">
      <div class="col-md-4">
        <div class="card text-center shadow-sm h-100">
          <div class="card-body py-2">
            <h6 class="card-title mb-1">Gesamte KM ${jahr}</h6>
            <p class="fs-4 fw-bold mb-0">${gesamtKm.toLocaleString("de-DE")} km</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card text-center shadow-sm h-100">
          <div class="card-body py-2">
            <h6 class="card-title mb-1">Privat / Geschäftlich / Arbeitsweg</h6>
            <p class="fw-bold mb-0" style="font-size:0.95rem;">
              Privat: ${totalPrivat.toLocaleString("de-DE")} km (${privatPct} %)<br>
              Geschäftlich: ${totalGeschaeft.toLocaleString("de-DE")} km (${geschaeftPct} %)<br>
              Arbeitsweg: ${totalArbeitsweg.toLocaleString("de-DE")} km (${arbeitswegPct} %)
            </p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card text-center shadow-sm h-100">
          <div class="card-body py-2">
            <h6 class="card-title mb-1">Aktive Monate</h6>
            <p class="fs-4 fw-bold mb-0">${monatsTabelle.length} / 12</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Diagramm + Tabelle nebeneinander im Druck -->
    <div class="print-layout">
      <!-- Diagramm -->
      <div class="print-chart-col">
        <h5 class="section-title">Gefahrene KM – Verlauf ${jahr}</h5>
        <div style="position:relative;">
          <canvas id="historyKmChart"></canvas>
          <!-- Wird beim Drucken durch dieses img ersetzt -->
          <img id="historyKmChartImg" style="display:none; width:100%;" />
        </div>
      </div>

      <!-- Tabelle -->
      <div class="print-table-col">
        <h5 class="section-title">Monatsübersicht ${jahr}</h5>
        <table class="table table-bordered table-striped table-sm mb-0" id="historyPrintTable">
          <thead class="table-dark">
            <tr>
              <th>Monat</th>
              <th>Start KM</th>
              <th>End KM</th>
              <th>Ges. KM</th>
              <th>Privat KM</th>
              <th>Gesch. KM</th>
              <th>Arbeitsw. KM</th>
              <th>Privat %</th>
              <th>Gesch. %</th>
              <th>Arbeitsw. %</th>
            </tr>
          </thead>
          <tbody id="historyTabelle"></tbody>
        </table>
      </div>
    </div>
  `;

  // Tabelle befüllen
  const tbody = document.getElementById("historyTabelle");
  monatsTabelle.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.month}</td>
      <td>${row.startKm.toLocaleString("de-DE")}</td>
      <td>${row.endKm.toLocaleString("de-DE")}</td>
      <td>${row.diff.toLocaleString("de-DE")}</td>
      <td>${row.privat.toLocaleString("de-DE")}</td>
      <td>${row.geschaeft.toLocaleString("de-DE")}</td>
      <td>${row.arbeitsweg.toLocaleString("de-DE")}</td>
      <td>${row.diff ? ((row.privat     / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
      <td>${row.diff ? ((row.geschaeft  / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
      <td>${row.diff ? ((row.arbeitsweg / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
    `;
    tbody.appendChild(tr);
  });

  // Chart zeichnen
  if (chartInstanzHistory) chartInstanzHistory.destroy();

  const chartLabels = monatsTabelle.map(row => {
    const [y, mo] = row.month.split("-");
    return new Date(y, parseInt(mo) - 1).toLocaleString("de-DE", { month: "short" });
  });

  chartInstanzHistory = new Chart(document.getElementById("historyKmChart"), {
    type: "bar",
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: "Geschäftlich",
          data: monatsTabelle.map(row => row.geschaeft),
          backgroundColor: "rgba(13, 110, 253, 0.75)",
          borderColor: "rgba(13, 110, 253, 1)",
          borderWidth: 2,
          borderRadius: 4,
          stack: "km"
        },
        {
          label: "Privat",
          data: monatsTabelle.map(row => row.privat),
          backgroundColor: "rgba(25, 135, 84, 0.75)",
          borderColor: "rgba(25, 135, 84, 1)",
          borderWidth: 2,
          borderRadius: 4,
          stack: "km"
        },
        {
          label: "Arbeitsweg",
          data: monatsTabelle.map(row => row.arbeitsweg),
          backgroundColor: "rgba(255, 193, 7, 0.75)",
          borderColor: "rgba(255, 193, 7, 1)",
          borderWidth: 2,
          borderRadius: 4,
          stack: "km"
        }
      ]
    },
    options: {
      responsive: true,
      animation: { duration: 400 },
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("de-DE")} km`
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { beginAtZero: true, stacked: true }
      }
    }
  });
}

// PDF / Drucken
function druckeSeite() {
  // Canvas → PNG konvertieren, damit es im Druckdialog erscheint
  const canvas = document.getElementById("historyKmChart");
  const img    = document.getElementById("historyKmChartImg");
  if (canvas && img) {
    img.src = canvas.toDataURL("image/png");
  }
  window.print();
}

// Initialisierung
function initHistory() {
  const jahrSelect = document.getElementById("historyJahrSelect");
  const aktuellesJahr = new Date().getFullYear();

  jahrSelect.innerHTML = "";
  for (let j = aktuellesJahr - 1; j >= START_JAHR; j--) {
    const opt = document.createElement("option");
    opt.value = j;
    opt.textContent = j;
    jahrSelect.appendChild(opt);
  }

  document.getElementById("historyCSVExport")?.addEventListener("click", () => {
    downloadDatei(mitFahrzeug(`/api/export/csv/year/${jahrSelect.value}`), `fahrten_${jahrSelect.value}.csv`);
  });

  document.getElementById("historyPDFExport")?.addEventListener("click", druckeSeite);

  jahrSelect.addEventListener("change", () => ladeHistoryDashboard(jahrSelect.value));
  ersteSynchronisierung.then(() => document.addEventListener("fahrtenNachgereicht", () => {
    if (jahrSelect.value) ladeHistoryDashboard(jahrSelect.value);
  }));

  if (jahrSelect.options.length > 0) {
    ladeHistoryDashboard(jahrSelect.value);
  } else {
    document.getElementById("historyLoading").classList.add("d-none");
    document.getElementById("historyContent").innerHTML = `
      <div class="alert alert-warning mt-4">
        Keine vergangenen Jahre verfügbar (START_JAHR = ${START_JAHR}).
      </div>`;
    document.getElementById("historyContent").classList.remove("d-none");
  }
}

document.addEventListener("DOMContentLoaded", initHistory);
