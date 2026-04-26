// js/dashboard-history.js

let chartInstanzHistory = null;

async function ladeHistoryDashboard(jahr) {
  const token = localStorage.getItem("authToken");
  const headers = { "Authorization": `Bearer ${token}` };

  let monatsKm = {};
  let gesamtKm = 0;
  let monatsTabelle = [];
  let prevEndKm = null;
  let totalPrivat = 0;
  let totalGeschaeft = 0;

  // Lade-Spinner anzeigen
  document.getElementById("historyLoading").classList.remove("d-none");
  document.getElementById("historyContent").classList.add("d-none");

  for (let m = 1; m <= 12; m++) {
    const month = `${jahr}-${String(m).padStart(2, "0")}`;

    try {
      const res = await fetch(`${API_BASE_URL}/api/export/json?month=${month}`, { headers });
      if (!res.ok) continue;
      const fahrten = await res.json();
      if (fahrten.length === 0) continue;

      const startKm = prevEndKm !== null
        ? prevEndKm
        : parseInt(fahrten[0].kmstand, 10);

      const endKm = parseInt(fahrten[fahrten.length - 1].kmstand, 10);
      const diff = endKm - startKm;

      prevEndKm = endKm;

      monatsKm[month] = diff;
      gesamtKm += diff;

      let privat = 0, geschaeft = 0;
      for (let i = 0; i < fahrten.length; i++) {
        let kmDelta;
        if (i === 0) {
          kmDelta = parseInt(fahrten[0].kmstand, 10) - startKm;
        } else {
          kmDelta = parseInt(fahrten[i].kmstand, 10) - parseInt(fahrten[i - 1].kmstand, 10);
        }
        if (kmDelta < 0) kmDelta = 0;

        if (fahrten[i].fahrtart.toLowerCase() === "privat") privat += kmDelta;
        else geschaeft += kmDelta;
      }

      monatsTabelle.push({ month, startKm, endKm, diff, privat, geschaeft });
      totalPrivat += privat;
      totalGeschaeft += geschaeft;

    } catch (e) {
      console.warn("Kein Monat:", month);
    }
  }

  // Lade-Spinner verstecken
  document.getElementById("historyLoading").classList.add("d-none");
  document.getElementById("historyContent").classList.remove("d-none");

  // Keine Daten vorhanden?
  if (monatsTabelle.length === 0) {
    document.getElementById("historyContent").innerHTML = `
      <div class="alert alert-info text-center mt-4">
        Keine Daten für das Jahr <strong>${jahr}</strong> vorhanden.
      </div>`;
    return;
  }

  // Content-Bereich neu aufbauen
  document.getElementById("historyContent").innerHTML = `
    <div class="row mb-4" id="statCards"></div>
    <h4 class="mt-4">Monatsübersicht ${jahr}</h4>
    <div class="table-responsive shadow-sm card mb-5">
      <table class="table table-bordered table-striped mb-0">
        <thead>
          <tr>
            <th>Monat</th>
            <th>Start KM</th>
            <th>End KM</th>
            <th>Gefahrene KM</th>
            <th>Privat KM</th>
            <th>Geschäftlich KM</th>
            <th>Privat %</th>
            <th>Geschäftlich %</th>
          </tr>
        </thead>
        <tbody id="historyTabelle"></tbody>
      </table>
    </div>
    <h4>Gefahrene KM – Verlauf ${jahr}</h4>
    <canvas id="historyKmChart" height="100" class="shadow-sm card mb-5"></canvas>
  `;

  // Stat-Karten
  const privatPct    = gesamtKm > 0 ? ((totalPrivat    / gesamtKm) * 100).toFixed(2) : "0.00";
  const geschaeftPct = gesamtKm > 0 ? ((totalGeschaeft / gesamtKm) * 100).toFixed(2) : "0.00";

  document.getElementById("statCards").innerHTML = `
    <div class="col-md-4">
      <div class="card text-center shadow-sm">
        <div class="card-body">
          <h5 class="card-title">Gesamte KM ${jahr}</h5>
          <p class="fs-3 fw-bold">${gesamtKm.toLocaleString("de-DE")} km</p>
        </div>
      </div>
    </div>
    <div class="col-md-4">
      <div class="card text-center shadow-sm">
        <div class="card-body">
          <h5 class="card-title">Privat / Geschäftlich</h5>
          <p class="fs-6 fw-bold mb-1">Privat: ${totalPrivat.toLocaleString("de-DE")} km (${privatPct} %)</p>
          <p class="fs-6 fw-bold mb-0">Geschäftlich: ${totalGeschaeft.toLocaleString("de-DE")} km (${geschaeftPct} %)</p>
        </div>
      </div>
    </div>
    <div class="col-md-4">
      <div class="card text-center shadow-sm">
        <div class="card-body">
          <h5 class="card-title">Aktive Monate</h5>
          <p class="fs-3 fw-bold">${monatsTabelle.length} / 12</p>
        </div>
      </div>
    </div>
  `;

  // Monats-Tabelle befüllen
  const tbody = document.getElementById("historyTabelle");
  tbody.innerHTML = "";
  monatsTabelle.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.month}</td>
      <td>${row.startKm.toLocaleString("de-DE")}</td>
      <td>${row.endKm.toLocaleString("de-DE")}</td>
      <td>${row.diff.toLocaleString("de-DE")}</td>
      <td>${row.privat.toLocaleString("de-DE")}</td>
      <td>${row.geschaeft.toLocaleString("de-DE")}</td>
      <td>${row.diff ? ((row.privat    / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
      <td>${row.diff ? ((row.geschaeft / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
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
        }
      ]
    },
    options: {
      responsive: true,
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

// Initialisierung: Jahre-Dropdown befüllen & Events setzen
function initHistory() {
  const jahrSelect = document.getElementById("historyJahrSelect");
  const aktuellesJahr = new Date().getFullYear();

  jahrSelect.innerHTML = "";
  // Vergangene Jahre (NICHT das aktuelle Jahr – dafür gibt es dashboard.js)
  for (let j = aktuellesJahr - 1; j >= START_JAHR; j--) {
    const opt = document.createElement("option");
    opt.value = j;
    opt.textContent = j;
    jahrSelect.appendChild(opt);
  }

  // CSV-Export
  document.getElementById("historyCSVExport")?.addEventListener("click", () => {
    const jahr = jahrSelect.value;
    window.location.href = `${API_BASE_URL}/api/export/csv/year/${jahr}`;
  });

  jahrSelect.addEventListener("change", () => ladeHistoryDashboard(jahrSelect.value));

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
