// js/auswertung.js
// Yearly analysis for dashboard and year history: key figures, breakdown
// by trip type, trend (stacked columns) and monthly overview –
// as a table on desktop, as month cards on smartphones.

// Analysis styles (once per page)
document.head.insertAdjacentHTML("beforeend", `<style>
  .kennzahl-wert { font-size: clamp(1.1rem, 5vw, 1.75rem); font-weight: 600; line-height: 1.2; white-space: nowrap; }
  .zahl, .monats-tabelle td { font-variant-numeric: tabular-nums; }
  .verlauf-diagramm { position: relative; height: 240px; }
  @media (min-width: 768px) { .verlauf-diagramm { height: 300px; } }
  @media print { .verlauf-druckbild { max-height: 230px; object-fit: contain; } }
</style>`);

const kmText   = n => `${(n ?? 0).toLocaleString(i18n.locale)} km`;
const num     = n => (n ?? 0).toLocaleString(i18n.locale);
// "3 trips" (number formatted, singular/plural via i18n)
const tripsText = n => t("analysis.trips", { count: n ?? 0, n: num(n) });
const share   = (part, whole) => (whole > 0 ? percentText((part / whole) * 100) : "–");
const monthFormat = kind => new Intl.DateTimeFormat(i18n.locale, { month: kind });
const longMonth = month => monthFormat("long").format(new Date(`${month}-01T12:00:00`));
const shortMonth = month => monthFormat("short").format(new Date(`${month}-01T12:00:00`));

// Breakdown bar: one segment per trip type with 2px gap (never color alone – legend next to it)
function splitBar(values, { height: barHeight = 10 } = {}) {
  const grandTotal = TRIP_TYPES.reduce((n, a) => n + (values[a.key] ?? 0), 0);
  const description = TRIP_TYPES.map(a => `${a.label} ${share(values[a.key], grandTotal)}`).join(", ");
  const segments = grandTotal === 0
    ? `<div style="flex:1;background:var(--bs-secondary-bg)"></div>`
    : TRIP_TYPES.filter(a => values[a.key] > 0).map(a =>
        `<div style="flex:${values[a.key]} 1 0;background:${a.chart}"></div>`).join("");
  return `<div class="aufteilung-balken" role="img" aria-label="${escapeHtml(description)}"
            style="display:flex;gap:2px;height:${barHeight}px;border-radius:${barHeight / 2}px;overflow:hidden">${segments}</div>`;
}

// Legend with color swatch, km and share (text in text color, identity via the swatch)
function splitLegend(values) {
  const grandTotal = TRIP_TYPES.reduce((n, a) => n + (values[a.key] ?? 0), 0);
  return TRIP_TYPES.map(a => `
    <div class="d-flex align-items-center gap-2">
      <span class="rounded-1 flex-shrink-0" style="width:12px;height:12px;background:${a.chart}"></span>
      <span class="flex-grow-1">${a.label}</span>
      <span class="fw-semibold zahl">${kmText(values[a.key])}</span>
      <span class="text-muted small text-end" style="min-width:3.5rem">${share(values[a.key], grandTotal)}</span>
    </div>`).join("");
}

function metricTile({ label, value: rawValue, hint: hint }) {
  return `
    <div class="col">
      <div class="card h-100 shadow-sm border-0">
        <div class="card-body p-2 p-md-3">
          <div class="small text-muted text-truncate">${escapeHtml(label)}</div>
          <div class="kennzahl-wert">${escapeHtml(rawValue)}</div>
          ${hint ? `<div class="small text-muted text-truncate">${escapeHtml(hint)}</div>` : ""}
        </div>
      </div>
    </div>`;
}

function monthTable(months) {
  const headerCells = TRIP_TYPES.map(a => `<th class="text-end">${a.label}</th>`).join("");
  const rows = months.map(m => `
    <tr>
      <td>${escapeHtml(longMonth(m.month))}</td>
      <td class="text-end">${num(m.start_km)}</td>
      <td class="text-end">${num(m.end_km)}</td>
      <td class="text-end fw-semibold">${num(m.total)}</td>
      ${TRIP_TYPES.map(a => `<td class="text-end">${num(m[a.key])} <span class="text-muted small">(${share(m[a.key], m.total)})</span></td>`).join("")}
      <td class="text-end">${num(m.trips)}</td>
    </tr>`).join("");
  return `
    <div class="table-responsive">
      <table class="table table-sm table-striped align-middle mb-0 monats-tabelle">
        <thead class="table-dark">
          <tr><th>${t("analysis.col.month")}</th><th class="text-end">${t("analysis.col.startKm")}</th><th class="text-end">${t("analysis.col.endKm")}</th>
              <th class="text-end">${t("analysis.col.driven")}</th>${headerCells}<th class="text-end">${t("analysis.col.trips")}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function monthCards(months) {
  return `<div class="list-group list-group-flush">${months.map(m => `
    <div class="list-group-item px-3 py-3">
      <div class="d-flex justify-content-between align-items-baseline">
        <strong>${escapeHtml(longMonth(m.month))}</strong>
        <span class="fw-semibold">${kmText(m.total)}</span>
      </div>
      <div class="my-2">${splitBar(m, { height: 8 })}</div>
      <div class="d-flex flex-wrap column-gap-3 row-gap-1 small">
        ${TRIP_TYPES.map(a => `<span class="text-nowrap"><span class="d-inline-block rounded-1 me-1" style="width:8px;height:8px;background:${a.chart}"></span>${a.label} ${num(m[a.key])}</span>`).join("")}
      </div>
      <div class="small text-muted mt-1">${num(m.start_km)} → ${num(m.end_km)} km · ${escapeHtml(tripsText(m.trips))}</div>
    </div>`).join("")}</div>`;
}

// Colors of the current theme (light/dark) for canvas charts
function chartColors() {
  return {
    ink:     cssColor("--bs-secondary-color") || "#6c757d",
    surface: cssColor("--bs-body-bg") || "#fff",                 // card background = gap between segments
    grid:  cssColor("--bs-border-color-translucent") || "rgba(0,0,0,.1)",
    series:  TRIP_TYPES.map(tripTypeColor),
  };
}

const charts = new Set();

function applyChartColors(chart) {
  const f = chartColors();
  chart.data.datasets.forEach((ds, i) => { ds.backgroundColor = f.series[i]; ds.borderColor = f.surface; });
  chart.options.plugins.legend.labels.color = f.ink;
  chart.options.scales.x.ticks.color = f.ink;
  chart.options.scales.y.ticks.color = f.ink;
  chart.options.scales.y.grid.color  = f.grid;
}

// Recolor immediately on light/dark switch (also before printing)
document.addEventListener("themaGeaendert", () => {
  for (const chart of charts) {
    if (!chart.canvas?.isConnected) { charts.delete(chart); continue; }
    applyChartColors(chart);
    chart.update("none");
  }
});

function drawHistoryChart(canvas, months) {
  const f = chartColors();
  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: months.map(m => shortMonth(m.month)),
      datasets: TRIP_TYPES.map((a, i) => ({
        label: a.label,
        data: months.map(m => m[a.key]),
        backgroundColor: f.series[i],
        borderColor: f.surface,
        borderWidth: 1,               // in background color → 2px gap between segments
        borderSkipped: false,
        borderRadius: 3,
        maxBarThickness: 24,
        stack: "km",
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        colors: { enabled: false },   // own colors, no automatic Chart.js palette
        legend: { position: "top", labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10, boxHeight: 10, color: f.ink } },
        tooltip: {
          callbacks: {
            label:  ctx => ` ${ctx.dataset.label}: ${kmText(ctx.parsed.y)}`,
            footer: items => t("analysis.total", { km: kmText(items.reduce((n, i) => n + i.parsed.y, 0)) }),
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: f.ink } },
        y: { stacked: true, beginAtZero: true, border: { display: false },
             grid: { color: f.grid }, ticks: { color: f.ink, callback: v => num(v) } },
      },
    },
  });
  charts.add(chart);
  return chart;
}

// Renders the complete analysis into `ziel` and returns the chart instance.
// kacheln: [{ label, wert, hinweis? }] for the key figures row
function showYearAnalysis(target, { year: selectedYear, months: months, sum: sums, tiles: tiles, oldChart: previousChart }) {
  previousChart?.destroy();

  if (months.length === 0) {
    target.innerHTML = `<div class="alert alert-info">${tHtml("analysis.noTrips", { year: selectedYear })}</div>`;
    return null;
  }

  target.innerHTML = `
    <div class="row row-cols-3 g-2 g-md-3 mb-3 kennzahlen">${tiles.map(metricTile).join("")}</div>

    <div class="row g-3 mb-3">
      <div class="col-lg-4">
        <div class="card shadow-sm border-0 h-100">
          <div class="card-body">
            <h2 class="h6 mb-3">${tHtml("analysis.split", { year: selectedYear })}</h2>
            ${splitBar(sums, { height: 14 })}
            <div class="d-grid gap-2 mt-3">${splitLegend(sums)}</div>
          </div>
        </div>
      </div>
      <div class="col-lg-8">
        <div class="card shadow-sm border-0 h-100">
          <div class="card-body">
            <h2 class="h6 mb-2">${t("analysis.kmPerMonth")}</h2>
            <div class="verlauf-diagramm d-print-none"><canvas aria-label="${escapeHtml(t("analysis.kmPerMonthAria"))}" role="img"></canvas></div>
            <img class="verlauf-druckbild d-none d-print-block w-100" alt="">
          </div>
        </div>
      </div>
    </div>

    <div class="card shadow-sm border-0">
      <div class="card-body pb-0"><h2 class="h6 mb-2">${t("analysis.monthlyOverview")}</h2></div>
      <div class="d-none d-md-block d-print-block">${monthTable(months)}</div>
      <div class="d-md-none d-print-none">${monthCards([...months].reverse())}</div>
    </div>`;

  return drawHistoryChart(target.querySelector("canvas"), months);
}
