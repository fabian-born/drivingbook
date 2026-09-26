// js/dashboard.js
// Dashboard: Auswertung des laufenden Jahres für das aktive Fahrzeug (siehe auswertung.js)

const aktuellesJahr  = new Date().getFullYear();
const aktuellerMonat = `${aktuellesJahr}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

let chartInstanz = null;

async function ladeDashboard() {
    const ziel = document.getElementById("dashboardInhalt");
    document.getElementById("dashboardJahr").textContent = aktuellesJahr;

    // Eine Abfrage fürs ganze Jahr; Strecken rechnet das Backend (ab dem letzten km-Stand des Vorjahres)
    const res = await apiFetch(mitFahrzeug(`/api/trips?year=${aktuellesJahr}`));
    if (!res.ok) {
        ziel.innerHTML = `<div class="alert alert-danger">${escapeHtml(await apiError(res))}</div>`;
        return;
    }
    const { months: monate, totals: summe } = await res.json();
    const dieserMonat = monate.find(m => m.month === aktuellerMonat);

    chartInstanz = zeigeJahresauswertung(ziel, {
        jahr: aktuellesJahr, monate, summe, alterChart: chartInstanz,
        kacheln: [
            { label: "Dieser Monat", wert: kmText(dieserMonat?.total),
              hinweis: `${zahl(dieserMonat?.trips)} Fahrt${dieserMonat?.trips === 1 ? "" : "en"}` },
            { label: `Jahr ${aktuellesJahr}`, wert: kmText(summe.total), hinweis: `${zahl(summe.trips)} Fahrten` },
            { label: "Ø pro Monat", wert: kmText(monate.length ? Math.round(summe.total / monate.length) : 0),
              hinweis: `${monate.length} Monat${monate.length === 1 ? "" : "e"}` },
        ],
    });
}

// Erinnerung: letzte Sicherung älter als 30 Tage und seitdem Änderungen
async function pruefeSicherung() {
    const status = await ladeSicherungsStatus().catch(() => null);
    const faellig = status?.vehicles.filter(v => v.remind) ?? [];
    const box = document.getElementById("sicherungHinweis");
    box.classList.toggle("d-none", faellig.length === 0);
    if (faellig.length === 0) return;

    const nie = faellig.every(v => !v.last_backup_at);
    document.getElementById("sicherungHinweisText").textContent = nie
        ? "Deine Fahrten wurden noch nie gesichert."
        : `Deine letzte Sicherung ist über ${status.reminder_days} Tage her und es gibt seitdem Änderungen.`;
}

document.getElementById("sicherungJetztBtn").addEventListener("click", async () => {
    await sichereAlles();
    pruefeSicherung();
});

Promise.all([fahrzeugBereit, ersteSynchronisierung]).then(() => {
    ladeDashboard();
    pruefeSicherung();
    beiAktualisierung(ladeDashboard);
});
