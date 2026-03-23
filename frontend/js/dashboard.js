// js/dashboard.js
const aktuellesJahr = new Date().getFullYear();
const aktuellerMonat = `${aktuellesJahr}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

let chartInstanz = null;

async function ladeDashboard() {
let monatsKm = {};
let gesamtKm = 0;
let monatsTabelle = [];
let prevEndKm = 56510;
let totalPrivat = 0;
let totalGeschaeft = 0;

```
for (let m = 1; m <= 12; m++) {
    const month = `${aktuellesJahr}-${String(m).padStart(2, "0")}`;

    try {
        const res = await fetch(`${API_BASE_URL}/api/export/json?month=${month}`);
        if (!res.ok) continue;
        const fahrten = await res.json();
        if (fahrten.length === 0) continue;

        // Start KM = End KM des Vormonats
        const startKm = prevEndKm;
        const endKm = parseInt(fahrten[fahrten.length - 1].kmstand, 10);
        const diff = endKm - startKm;

        prevEndKm = endKm;

        monatsKm[month] = diff;
        gesamtKm += diff;

        // Privat / Geschäftlich korrekt berechnen
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

        monatsTabelle.push({ month, startKm, endKm, diff, privat, geschaeft });
        totalPrivat += privat;
        totalGeschaeft += geschaeft;

    } catch (e) {
        console.warn("Kein Monat:", month);
    }
}

// ✅ Fix: Aktueller Monat statt Durchschnitt
document.getElementById("kmProMonat").innerText =
    (monatsKm[aktuellerMonat] ?? 0).toFixed(1);

// ✅ Fix: Division durch 0 abgesichert
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

// ✅ Fix: Chart-Instanz vorher zerstören um Doppel-Rendering zu vermeiden
if (chartInstanz) {
    chartInstanz.destroy();
}

chartInstanz = new Chart(document.getElementById("kmChart"), {
    type: "line",
    data: {
        labels: Object.keys(monatsKm),
        datasets: [{
            label: "Gefahrene KM",
            data: Object.values(monatsKm),
            borderWidth: 2,
            fill: true,
            tension: 0.3
        }]
    }
});
```

}

ladeDashboard();