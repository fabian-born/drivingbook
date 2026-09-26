// js/dashboard-history.js
// Year history: analysis of completed years for the active vehicle (see analysis.js)

let historyChartInstance = null;

async function loadHistoryDashboard(selectedYear) {
  const target = document.getElementById("historyContent");
  document.getElementById("printHeadline").textContent = t("history.printHeadline", { year: selectedYear });
  await Promise.all([vehicleReady, initialSync]);

  let rawData = { months: [], totals: { total: 0, trips: 0 } };
  try {
    const res = await apiFetch(withVehicle(`/api/trips?year=${selectedYear}`));
    if (!res.ok) throw new Error(await apiError(res));
    rawData = await res.json();
  } catch (err) {
    target.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
    return;
  }

  const { months: months, totals: sums } = rawData;
  historyChartInstance = showYearAnalysis(target, {
    year: selectedYear, months: months, sum: sums, oldChart: historyChartInstance,
    tiles: [
      { label: t("history.total", { year: selectedYear }), value: kmText(sums.total), hint: t("history.trips", { count: sums.trips, n: num(sums.trips) }) },
      { label: t("history.perMonth"), value: kmText(months.length ? Math.round(sums.total / months.length) : 0) },
      { label: t("history.activeMonths"), value: `${months.length} / 12` },
    ],
  });
}

// Printing: insert the chart as an image so it shows up in print.
// "beforeprint" runs after theme.js (switch to light) – also on Ctrl+P.
window.addEventListener("beforeprint", () => {
  const canvas = document.querySelector("#historyContent canvas");
  const image   = document.querySelector("#historyContent .history-print");
  if (canvas && image) image.src = canvas.toDataURL("image/png");
});

function printPage() {
  window.print();
}

function initHistory() {
  const yearSelect    = document.getElementById("historyYearSelect");
  const currentYear = new Date().getFullYear();

  for (let j = currentYear - 1; j >= START_YEAR; j--) {
    yearSelect.insertAdjacentHTML("beforeend", `<option value="${j}">${j}</option>`);
  }

  document.getElementById("historyCSVExport").addEventListener("click", () => {
    downloadFile(withVehicle(`/api/export/csv/year/${yearSelect.value}`), `fahrten_${yearSelect.value}.csv`);
  });
  document.getElementById("historyPDFExport").addEventListener("click", printPage);
  yearSelect.addEventListener("change", () => loadHistoryDashboard(yearSelect.value));

  initialSync.then(() => onRefresh(() => {
    if (yearSelect.value) return loadHistoryDashboard(yearSelect.value);
  }));

  if (yearSelect.options.length > 0) {
    loadHistoryDashboard(yearSelect.value);
  } else {
    document.getElementById("historyContent").innerHTML = `
      <div class="alert alert-warning">${tHtml("history.noYears", { start: START_YEAR })}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", initHistory);
