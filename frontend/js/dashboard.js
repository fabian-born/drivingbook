// js/dashboard.js
const aktuellesJahr = new Date().getFullYear();
const aktuellerMonat = `${aktuellesJahr}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

let chartInstanz = null;

async function ladeDashboard() {
let monatsKm = {};
let monatsPrivat = {};
let monatsGeschaeft = {};
let gesamtKm = 0;
let monatsTabelle = [];
let prevEndKm = null;   // Startwert = erste Fahrt des Jahres
let totalPrivat = 0;
let totalGeschaeft = 0;


for (let m = 1; m <= 12; m++) {
    const month = `${aktuellesJahr}-${String(m).padStart(2, "0")}`;

    try {
        const res = await apiFetch(mitFahrzeug(`/api/export/json?month=${month}`));
        if (!res.ok) continue;
        const fahrten = await res.json();
        if (fahrten.length === 0) continue;

        const startKm = prevEndKm ?? parseInt(fahrten[0].kmstand, 10);
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

            if (fahrten[i].fahrtart.toLowerCase() === "privat") privat += kmDelta;
            else geschaeft += kmDelta;
        }

        monatsPrivat[month] = privat;
        monatsGeschaeft[month] = geschaeft;

        monatsTabelle.push({ month, startKm, endKm, diff, privat, geschaeft });
        totalPrivat += privat;
        totalGeschaeft += geschaeft;

    } catch (e) {
        console.warn("Kein Monat:", month);
    }
}

document.getElementById("kmProMonat").innerText =
    (monatsKm[aktuellerMonat] ?? 0).toFixed(1);

const privatPct  = gesamtKm > 0 ? ((totalPrivat   / gesamtKm) * 100).toFixed(2) : "0.00";
const geschaeftPct = gesamtKm > 0 ? ((totalGeschaeft / gesamtKm) * 100).toFixed(2) : "0.00";

document.getElementById("splitKm").innerText =
    `Privat: ${totalPrivat} (${privatPct} %) km\nGeschäftlich: ${totalGeschaeft} (${geschaeftPct} %) km`;

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
        <td>${row.diff ? ((row.privat    / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
        <td>${row.diff ? ((row.geschaeft / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
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

fahrzeugBereit.then(ladeDashboard);
