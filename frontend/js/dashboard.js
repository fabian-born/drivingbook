// js/dashboard.js
const aktuellesJahr = new Date().getFullYear();
const aktuellerMonat = `${aktuellesJahr}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

let chartInstanz = null;

async function ladeDashboard() {
// Eine Abfrage fürs ganze Jahr; Strecken rechnet das Backend (ab dem letzten km-Stand des Vorjahres)
const res = await apiFetch(mitFahrzeug(`/api/fahrten?year=${aktuellesJahr}`));
if (!res.ok) return console.warn("Dashboard:", await apiError(res));
const { monate, summe } = await res.json();

const monatsTabelle = monate.map(m => ({
    month: m.monat, startKm: m.start_km, endKm: m.end_km,
    diff: m.gesamt, privat: m.privat, geschaeft: m.geschaeftlich, arbeitsweg: m.arbeitsweg,
}));
const monatsKm       = Object.fromEntries(monatsTabelle.map(m => [m.month, m.diff]));
const gesamtKm       = summe.gesamt;
const totalPrivat    = summe.privat;
const totalGeschaeft = summe.geschaeftlich;
const totalArbeitsweg = summe.arbeitsweg;

document.getElementById("kmProMonat").innerText =
    (monatsKm[aktuellerMonat] ?? 0).toFixed(1);

const privatPct  = gesamtKm > 0 ? ((totalPrivat   / gesamtKm) * 100).toFixed(2) : "0.00";
const geschaeftPct = gesamtKm > 0 ? ((totalGeschaeft / gesamtKm) * 100).toFixed(2) : "0.00";
const arbeitswegPct = gesamtKm > 0 ? ((totalArbeitsweg / gesamtKm) * 100).toFixed(2) : "0.00";

document.getElementById("splitKm").innerText =
    `Privat: ${totalPrivat} (${privatPct} %) km\nGeschäftlich: ${totalGeschaeft} (${geschaeftPct} %) km\nArbeitsweg: ${totalArbeitsweg} (${arbeitswegPct} %) km`;

document.getElementById("kmGesamtJahr").innerText = gesamtKm;

// Monats-Tabelle
const tbody = document.getElementById("monatsTabelle");
tbody.innerHTML = "";
monatsTabelle.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td>${row.month}</td>
        <td>${row.startKm}</td>
        <td>${row.endKm}</td>
        <td>${row.diff}</td>
        <td>${row.privat}</td>
        <td>${row.geschaeft}</td>
        <td>${row.arbeitsweg}</td>
        <td>${row.diff ? ((row.privat     / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
        <td>${row.diff ? ((row.geschaeft  / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
        <td>${row.diff ? ((row.arbeitsweg / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
    `;
    tbody.appendChild(tr);
});

// Chart-Instanz vorher zerstören
if (chartInstanz) {
    chartInstanz.destroy();
}

const chartLabels = monatsTabelle.map(row => {
    const [y, mo] = row.month.split("-");
    return new Date(y, parseInt(mo) - 1).toLocaleString("de-DE", { month: "short" });
});

chartInstanz = new Chart(document.getElementById("kmChart"), {
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

// Erinnerung: letzte Sicherung älter als 30 Tage und seitdem Änderungen
async function pruefeSicherung() {
    const status = await ladeSicherungsStatus().catch(() => null);
    const faellig = status?.fahrzeuge.filter(v => v.erinnern) ?? [];
    const box = document.getElementById("sicherungHinweis");
    box.classList.toggle("d-none", faellig.length === 0);
    if (faellig.length === 0) return;

    const nie = faellig.every(v => !v.last_backup_at);
    document.getElementById("sicherungHinweisText").textContent = nie
        ? "Deine Fahrten wurden noch nie gesichert."
        : `Deine letzte Sicherung ist über ${status.erinnerung_tage} Tage her und es gibt seitdem Änderungen.`;
}

document.getElementById("sicherungJetztBtn").addEventListener("click", async () => {
    await sichereAlles();
    pruefeSicherung();
});

Promise.all([fahrzeugBereit, ersteSynchronisierung]).then(() => {
    ladeDashboard();
    pruefeSicherung();
    document.addEventListener("fahrtenNachgereicht", ladeDashboard);
});
