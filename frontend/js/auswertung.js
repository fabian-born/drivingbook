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
const zahl     = n => (n ?? 0).toLocaleString(i18n.locale);
// "3 trips" (number formatted, singular/plural via i18n)
const fahrtenText = n => t("analysis.trips", { count: n ?? 0, n: zahl(n) });
const anteil   = (teil, ganz) => (ganz > 0 ? prozentText((teil / ganz) * 100) : "–");
const monatsFormat = art => new Intl.DateTimeFormat(i18n.locale, { month: art });
const monatLang = monat => monatsFormat("long").format(new Date(`${monat}-01T12:00:00`));
const monatKurz = monat => monatsFormat("short").format(new Date(`${monat}-01T12:00:00`));

// Breakdown bar: one segment per trip type with 2px gap (never color alone – legend next to it)
function aufteilungsBalken(werte, { hoehe = 10 } = {}) {
  const gesamt = FAHRTARTEN.reduce((n, a) => n + (werte[a.key] ?? 0), 0);
  const beschreibung = FAHRTARTEN.map(a => `${a.label} ${anteil(werte[a.key], gesamt)}`).join(", ");
  const segmente = gesamt === 0
    ? `<div style="flex:1;background:var(--bs-secondary-bg)"></div>`
    : FAHRTARTEN.filter(a => werte[a.key] > 0).map(a =>
        `<div style="flex:${werte[a.key]} 1 0;background:${a.chart}"></div>`).join("");
  return `<div class="aufteilung-balken" role="img" aria-label="${escapeHtml(beschreibung)}"
            style="display:flex;gap:2px;height:${hoehe}px;border-radius:${hoehe / 2}px;overflow:hidden">${segmente}</div>`;
}

// Legend with color swatch, km and share (text in text color, identity via the swatch)
function aufteilungsLegende(werte) {
  const gesamt = FAHRTARTEN.reduce((n, a) => n + (werte[a.key] ?? 0), 0);
  return FAHRTARTEN.map(a => `
    <div class="d-flex align-items-center gap-2">
      <span class="rounded-1 flex-shrink-0" style="width:12px;height:12px;background:${a.chart}"></span>
      <span class="flex-grow-1">${a.label}</span>
      <span class="fw-semibold zahl">${kmText(werte[a.key])}</span>
      <span class="text-muted small text-end" style="min-width:3.5rem">${anteil(werte[a.key], gesamt)}</span>
    </div>`).join("");
}

function kennzahlKachel({ label, wert, hinweis }) {
  return `
    <div class="col">
      <div class="card h-100 shadow-sm border-0">
        <div class="card-body p-2 p-md-3">
          <div class="small text-muted text-truncate">${escapeHtml(label)}</div>
          <div class="kennzahl-wert">${escapeHtml(wert)}</div>
          ${hinweis ? `<div class="small text-muted text-truncate">${escapeHtml(hinweis)}</div>` : ""}
        </div>
      </div>
    </div>`;
}

function monatsTabelle(monate) {
  const kopf = FAHRTARTEN.map(a => `<th class="text-end">${a.label}</th>`).join("");
  const zeilen = monate.map(m => `
    <tr>
      <td>${escapeHtml(monatLang(m.month))}</td>
      <td class="text-end">${zahl(m.start_km)}</td>
      <td class="text-end">${zahl(m.end_km)}</td>
      <td class="text-end fw-semibold">${zahl(m.total)}</td>
      ${FAHRTARTEN.map(a => `<td class="text-end">${zahl(m[a.key])} <span class="text-muted small">(${anteil(m[a.key], m.total)})</span></td>`).join("")}
      <td class="text-end">${zahl(m.trips)}</td>
    </tr>`).join("");
  return `
    <div class="table-responsive">
      <table class="table table-sm table-striped align-middle mb-0 monats-tabelle">
        <thead class="table-dark">
          <tr><th>${t("analysis.col.month")}</th><th class="text-end">${t("analysis.col.startKm")}</th><th class="text-end">${t("analysis.col.endKm")}</th>
              <th class="text-end">${t("analysis.col.driven")}</th>${kopf}<th class="text-end">${t("analysis.col.trips")}</th></tr>
        </thead>
        <tbody>${zeilen}</tbody>
      </table>
    </div>`;
}

function monatsKarten(monate) {
  return `<div class="list-group list-group-flush">${monate.map(m => `
    <div class="list-group-item px-3 py-3">
      <div class="d-flex justify-content-between align-items-baseline">
        <strong>${escapeHtml(monatLang(m.month))}</strong>
        <span class="fw-semibold">${kmText(m.total)}</span>
      </div>
      <div class="my-2">${aufteilungsBalken(m, { hoehe: 8 })}</div>
      <div class="d-flex flex-wrap column-gap-3 row-gap-1 small">
        ${FAHRTARTEN.map(a => `<span class="text-nowrap"><span class="d-inline-block rounded-1 me-1" style="width:8px;height:8px;background:${a.chart}"></span>${a.label} ${zahl(m[a.key])}</span>`).join("")}
      </div>
      <div class="small text-muted mt-1">${zahl(m.start_km)} → ${zahl(m.end_km)} km · ${escapeHtml(fahrtenText(m.trips))}</div>
    </div>`).join("")}</div>`;
}

// Colors of the current theme (light/dark) for canvas charts
function diagrammFarben() {
  return {
    ink:     cssFarbe("--bs-secondary-color") || "#6c757d",
    flaeche: cssFarbe("--bs-body-bg") || "#fff",                 // card background = gap between segments
    raster:  cssFarbe("--bs-border-color-translucent") || "rgba(0,0,0,.1)",
    serien:  FAHRTARTEN.map(fahrtartFarbe),
  };
}

const diagramme = new Set();

function faerbeEin(chart) {
  const f = diagrammFarben();
  chart.data.datasets.forEach((ds, i) => { ds.backgroundColor = f.serien[i]; ds.borderColor = f.flaeche; });
  chart.options.plugins.legend.labels.color = f.ink;
  chart.options.scales.x.ticks.color = f.ink;
  chart.options.scales.y.ticks.color = f.ink;
  chart.options.scales.y.grid.color  = f.raster;
}

// Recolor immediately on light/dark switch (also before printing)
document.addEventListener("themaGeaendert", () => {
  for (const chart of diagramme) {
    if (!chart.canvas?.isConnected) { diagramme.delete(chart); continue; }
    faerbeEin(chart);
    chart.update("none");
  }
});

function zeichneVerlauf(canvas, monate) {
  const f = diagrammFarben();
  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: monate.map(m => monatKurz(m.month)),
      datasets: FAHRTARTEN.map((a, i) => ({
        label: a.label,
        data: monate.map(m => m[a.key]),
        backgroundColor: f.serien[i],
        borderColor: f.flaeche,
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
             grid: { color: f.raster }, ticks: { color: f.ink, callback: v => zahl(v) } },
      },
    },
  });
  diagramme.add(chart);
  return chart;
}

// Renders the complete analysis into `ziel` and returns the chart instance.
// kacheln: [{ label, wert, hinweis? }] for the key figures row
function zeigeJahresauswertung(ziel, { jahr, monate, summe, kacheln, alterChart }) {
  alterChart?.destroy();

  if (monate.length === 0) {
    ziel.innerHTML = `<div class="alert alert-info">${tHtml("analysis.noTrips", { year: jahr })}</div>`;
    return null;
  }

  ziel.innerHTML = `
    <div class="row row-cols-3 g-2 g-md-3 mb-3 kennzahlen">${kacheln.map(kennzahlKachel).join("")}</div>

    <div class="row g-3 mb-3">
      <div class="col-lg-4">
        <div class="card shadow-sm border-0 h-100">
          <div class="card-body">
            <h2 class="h6 mb-3">${tHtml("analysis.split", { year: jahr })}</h2>
            ${aufteilungsBalken(summe, { hoehe: 14 })}
            <div class="d-grid gap-2 mt-3">${aufteilungsLegende(summe)}</div>
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
      <div class="d-none d-md-block d-print-block">${monatsTabelle(monate)}</div>
      <div class="d-md-none d-print-none">${monatsKarten([...monate].reverse())}</div>
    </div>`;

  return zeichneVerlauf(ziel.querySelector("canvas"), monate);
}
