// js/sicherung.js
// Backup & restore – used in the account (everything), in the
// vehicle info (one vehicle) and for the reminder on the dashboard.

const today       = () => new Date().toISOString().slice(0, 10);
const shortDate   = d => (d ? new Date(d).toLocaleDateString(i18n.locale) : t("common.never"));

function backupAll() {
  return downloadFile("/api/backup", `${t("backup.fileAll")}_${today()}.json`);
}

function backupVehicleFile(vehicle) {
  return downloadFile(`/api/vehicles/${vehicle.id}/export`, `${t("backup.fileVehicle")}_${vehicle.code}_${today()}.json`);
}

async function loadBackupStatus() {
  const res = await apiFetch("/api/backup/status");
  return res.ok ? res.json() : null;
}

function resultLine(name, e) {
  const parts = [t("backup.added", { count: e.trips })];
  if (e.reassigned) parts.push(t("backup.reassigned", { count: e.reassigned }));
  if (e.skipped)    parts.push(t("backup.skipped", { count: e.skipped }));
  if (e.years)      parts.push(t("backup.years", { count: e.years }));
  if (e.audit)      parts.push(t("backup.audit", { count: e.audit }));
  return `${name}${e.created ? t("backup.created") : ""}: ${parts.join(", ")}`;
}

// Reads a backup file (full or vehicle backup), asks for confirmation and
// restores it. Returns { text, vehicle } or null on cancel; throws on errors.
async function restoreBackup(file) {
  let rawData;
  try {
    rawData = JSON.parse(await file.text());
  } catch {
    throw new Error(t("backup.invalidJson"));
  }

  if (["drivingbook-sicherung", "drivingbook-fahrzeug"].includes(rawData.format)) {
    throw new Error(t("backup.oldFormat"));
  }
  const grandTotal = rawData.format === "drivingbook-backup";
  if (!grandTotal && rawData.format !== "drivingbook-vehicle") {
    throw new Error(t("backup.notABackup"));
  }

  const content = grandTotal
    ? t("backup.contentAll", { count: rawData.vehicles?.length ?? 0 })
    : t("backup.contentVehicle", { name: rawData.vehicle?.name });
  const created = rawData.created_at;
  if (!confirm(`${t("backup.confirmRestore", { date: shortDate(created), content: content })}\n\n` +
               t("backup.confirmHint"))) {
    return null;
  }

  const res = await apiFetch(grandTotal ? "/api/backup/restore" : "/api/vehicles/import", { method: "POST", body: rawData });
  if (!res.ok) throw new Error(await apiError(res, t("backup.restoreFailed")));
  const e = await res.json();

  if (!grandTotal) {
    return { text: resultLine(e.vehicle.name, { ...e.imported, created: e.created }), vehicle: e.vehicle };
  }
  const rows = e.vehicles.map(f => resultLine(f.name, f));
  if (e.unassigned.trips || e.unassigned.audit) rows.push(resultLine(t("backup.unassigned"), e.unassigned));
  return { text: rows.join("\n"), vehicle: null };
}
