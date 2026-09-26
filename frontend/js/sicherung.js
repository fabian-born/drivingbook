// js/sicherung.js
// Sicherung & Wiederherstellung – genutzt im Konto (alles), in der
// Auto-Info (ein Fahrzeug) und für die Erinnerung auf dem Dashboard.

const heute       = () => new Date().toISOString().slice(0, 10);
const datumKurz   = d => (d ? new Date(d).toLocaleDateString("de-DE") : "noch nie");

function sichereAlles() {
  return downloadDatei("/api/backup", `fahrtenbuch_sicherung_${heute()}.json`);
}

function sichereFahrzeugDatei(vehicle) {
  return downloadDatei(`/api/vehicles/${vehicle.id}/export`, `fahrzeug_${vehicle.code}_${heute()}.json`);
}

async function ladeSicherungsStatus() {
  const res = await apiFetch("/api/backup/status");
  return res.ok ? res.json() : null;
}

function zeileErgebnis(name, e) {
  const teile = [`${e.trips} Fahrt(en) ergänzt`];
  if (e.reassigned) teile.push(`${e.reassigned} wieder zugeordnet`);
  if (e.skipped)    teile.push(`${e.skipped} bereits vorhanden`);
  if (e.years)      teile.push(`${e.years} Jahr(e) Kosten`);
  if (e.audit)      teile.push(`${e.audit} Protokolleinträge`);
  return `${name}${e.created ? " (neu angelegt)" : ""}: ${teile.join(", ")}`;
}

// Liest eine Sicherungsdatei (Gesamt- oder Fahrzeug-Sicherung), fragt nach und
// stellt wieder her. Liefert { text, vehicle } oder null bei Abbruch; wirft bei Fehlern.
async function stelleSicherungWiederHer(datei) {
  let daten;
  try {
    daten = JSON.parse(await datei.text());
  } catch {
    throw new Error("Die Datei ist kein gültiges JSON.");
  }

  // Aktuelles Format (v2) und altes Format (v1, deutsche Felder) – das Backend übersetzt v1
  const gesamt = ["drivingbook-backup", "drivingbook-sicherung"].includes(daten.format);
  if (!gesamt && !["drivingbook-vehicle", "drivingbook-fahrzeug"].includes(daten.format)) {
    throw new Error("Die Datei ist keine Fahrtenbuch-Sicherung.");
  }

  const inhalt = gesamt
    ? `${(daten.vehicles ?? daten.fahrzeuge)?.length ?? 0} Fahrzeug(en)`
    : `dem Fahrzeug „${(daten.vehicle ?? daten.fahrzeug)?.name}“`;
  const erstellt = daten.created_at ?? daten.erstellt_am ?? daten.exportiert_am;
  if (!confirm(`Sicherung vom ${datumKurz(erstellt)} mit ${inhalt} wiederherstellen?\n\n` +
               "Vorhandene Daten bleiben unverändert – nur Fehlendes wird ergänzt.")) {
    return null;
  }

  const res = await apiFetch(gesamt ? "/api/backup/restore" : "/api/vehicles/import", { method: "POST", body: daten });
  if (!res.ok) throw new Error(await apiError(res, "Wiederherstellung fehlgeschlagen"));
  const e = await res.json();

  if (!gesamt) {
    return { text: zeileErgebnis(e.vehicle.name, { ...e.imported, created: e.created }), vehicle: e.vehicle };
  }
  const zeilen = e.vehicles.map(f => zeileErgebnis(f.name, f));
  if (e.unassigned.trips || e.unassigned.audit) zeilen.push(zeileErgebnis("Ohne Fahrzeug", e.unassigned));
  return { text: zeilen.join("\n"), vehicle: null };
}
