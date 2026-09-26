// js/dashboard.js
// Dashboard: analysis of the current year for the active vehicle (see auswertung.js)

const aktuellesJahr  = new Date().getFullYear();
const aktuellerMonat = `${aktuellesJahr}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

let chartInstanz = null;

async function ladeDashboard() {
    const ziel = document.getElementById("dashboardInhalt");
    document.getElementById("dashboardJahr").textContent = aktuellesJahr;

    // One query for the whole year; the backend computes distances (from the previous year's last odometer reading)
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
            { label: t("dashboard.thisMonth"), wert: kmText(dieserMonat?.total),
              hinweis: fahrtenText(dieserMonat?.trips) },
            { label: t("analysis.year", { year: aktuellesJahr }), wert: kmText(summe.total), hinweis: fahrtenText(summe.trips) },
            { label: t("dashboard.avgPerMonth"), wert: kmText(monate.length ? Math.round(summe.total / monate.length) : 0),
              hinweis: t("dashboard.months", { count: monate.length }) },
        ],
    });
}

// Reminder: last backup older than 30 days and changes since then
async function pruefeSicherung() {
    const status = await ladeSicherungsStatus().catch(() => null);
    const faellig = status?.vehicles.filter(v => v.remind) ?? [];
    const box = document.getElementById("sicherungHinweis");
    box.classList.toggle("d-none", faellig.length === 0);
    if (faellig.length === 0) return;

    const nie = faellig.every(v => !v.last_backup_at);
    document.getElementById("sicherungHinweisText").textContent = nie
        ? t("dashboard.neverBackedUp")
        : t("dashboard.backupOverdue", { days: status.reminder_days });
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
