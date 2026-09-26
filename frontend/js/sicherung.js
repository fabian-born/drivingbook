// js/sicherung.js
// Backup & restore – used in the account (everything), in the
// vehicle info (one vehicle) and for the reminder on the dashboard.

const heute       = () => new Date().toISOString().slice(0, 10);
const datumKurz   = d => (d ? new Date(d).toLocaleDateString(i18n.locale) : t("common.never"));

function sichereAlles() {
  return downloadDatei("/api/backup", `${t("backup.fileAll")}_${heute()}.json`);
}

function sichereFahrzeugDatei(vehicle) {
  return downloadDatei(`/api/vehicles/${vehicle.id}/export`, `${t("backup.fileVehicle")}_${vehicle.code}_${heute()}.json`);
}

async function ladeSicherungsStatus() {
  const res = await apiFetch("/api/backup/status");
  return res.ok ? res.json() : null;
}

function zeileErgebnis(name, e) {
  const teile = [t("backup.added", { count: e.trips })];
  if (e.reassigned) teile.push(t("backup.reassigned", { count: e.reassigned }));
  if (e.skipped)    teile.push(t("backup.skipped", { count: e.skipped }));
  if (e.years)      teile.push(t("backup.years", { count: e.years }));
  if (e.audit)      teile.push(t("backup.audit", { count: e.audit }));
  return `${name}${e.created ? t("backup.created") : ""}: ${teile.join(", ")}`;
}

// Reads a backup file (full or vehicle backup), asks for confirmation and
// restores it. Returns { text, vehicle } or null on cancel; throws on errors.
async function stelleSicherungWiederHer(datei) {
  let daten;
  try {
    daten = JSON.parse(await datei.text());
  } catch {
    throw new Error(t("backup.invalidJson"));
  }

  if (["drivingbook-sicherung", "drivingbook-fahrzeug"].includes(daten.format)) {
    throw new Error(t("backup.oldFormat"));
  }
  const gesamt = daten.format === "drivingbook-backup";
  if (!gesamt && daten.format !== "drivingbook-vehicle") {
    throw new Error(t("backup.notABackup"));
  }

  const inhalt = gesamt
    ? t("backup.contentAll", { count: daten.vehicles?.length ?? 0 })
    : t("backup.contentVehicle", { name: daten.vehicle?.name });
  const erstellt = daten.created_at;
  if (!confirm(`${t("backup.confirmRestore", { date: datumKurz(erstellt), content: inhalt })}\n\n` +
               t("backup.confirmHint"))) {
    return null;
  }

  const res = await apiFetch(gesamt ? "/api/backup/restore" : "/api/vehicles/import", { method: "POST", body: daten });
  if (!res.ok) throw new Error(await apiError(res, t("backup.restoreFailed")));
  const e = await res.json();

  if (!gesamt) {
    return { text: zeileErgebnis(e.vehicle.name, { ...e.imported, created: e.created }), vehicle: e.vehicle };
  }
  const zeilen = e.vehicles.map(f => zeileErgebnis(f.name, f));
  if (e.unassigned.trips || e.unassigned.audit) zeilen.push(zeileErgebnis(t("backup.unassigned"), e.unassigned));
  return { text: zeilen.join("\n"), vehicle: null };
}
