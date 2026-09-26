// js/dashboard.js
// Dashboard: analysis of the current year for the active vehicle (see auswertung.js)

const currentYear  = new Date().getFullYear();
const currentMonth = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

let chartInstance = null;

async function loadDashboard() {
    const target = document.getElementById("dashboardInhalt");
    document.getElementById("dashboardJahr").textContent = currentYear;

    // One query for the whole year; the backend computes distances (from the previous year's last odometer reading)
    const res = await apiFetch(withVehicle(`/api/trips?year=${currentYear}`));
    if (!res.ok) {
        target.innerHTML = `<div class="alert alert-danger">${escapeHtml(await apiError(res))}</div>`;
        return;
    }
    const { months: months, totals: sums } = await res.json();
    const thisMonth = months.find(m => m.month === currentMonth);

    chartInstance = showYearAnalysis(target, {
        year: currentYear, months: months, sum: sums, oldChart: chartInstance,
        tiles: [
            { label: t("dashboard.thisMonth"), value: kmText(thisMonth?.total),
              hint: tripsText(thisMonth?.trips) },
            { label: t("analysis.year", { year: currentYear }), value: kmText(sums.total), hint: tripsText(sums.trips) },
            { label: t("dashboard.avgPerMonth"), value: kmText(months.length ? Math.round(sums.total / months.length) : 0),
              hint: t("dashboard.months", { count: months.length }) },
        ],
    });
}

// Reminder: last backup older than 30 days and changes since then
async function checkBackup() {
    const status = await loadBackupStatus().catch(() => null);
    const due = status?.vehicles.filter(v => v.remind) ?? [];
    const box = document.getElementById("sicherungHinweis");
    box.classList.toggle("d-none", due.length === 0);
    if (due.length === 0) return;

    const neverBackedUp = due.every(v => !v.last_backup_at);
    document.getElementById("sicherungHinweisText").textContent = neverBackedUp
        ? t("dashboard.neverBackedUp")
        : t("dashboard.backupOverdue", { days: status.reminder_days });
}

document.getElementById("sicherungJetztBtn").addEventListener("click", async () => {
    await backupAll();
    checkBackup();
});

Promise.all([vehicleReady, initialSync]).then(() => {
    loadDashboard();
    checkBackup();
    onRefresh(loadDashboard);
});
