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
  const teile = [`${e.fahrten} Fahrt(en) ergänzt`];
  if (e.zugeordnet)    teile.push(`${e.zugeordnet} wieder zugeordnet`);
  if (e.uebersprungen) teile.push(`${e.uebersprungen} bereits vorhanden`);
  if (e.jahre)         teile.push(`${e.jahre} Jahr(e) Kosten`);
  if (e.protokoll)     teile.push(`${e.protokoll} Protokolleinträge`);
  return `${name}${e.neu ? " (neu angelegt)" : ""}: ${teile.join(", ")}`;
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

  const gesamt = daten.format === "drivingbook-sicherung";
  if (!gesamt && daten.format !== "drivingbook-fahrzeug") {
    throw new Error("Die Datei ist keine Fahrtenbuch-Sicherung.");
  }

  const inhalt = gesamt ? `${daten.fahrzeuge?.length ?? 0} Fahrzeug(en)` : `dem Fahrzeug „${daten.fahrzeug?.name}“`;
  const erstellt = daten.erstellt_am ?? daten.exportiert_am;
  if (!confirm(`Sicherung vom ${datumKurz(erstellt)} mit ${inhalt} wiederherstellen?\n\n` +
               "Vorhandene Daten bleiben unverändert – nur Fehlendes wird ergänzt.")) {
    return null;
  }

  const res = await apiFetch(gesamt ? "/api/backup/restore" : "/api/vehicles/import", { method: "POST", body: daten });
  if (!res.ok) throw new Error(await apiError(res, "Wiederherstellung fehlgeschlagen"));
  const e = await res.json();

  if (!gesamt) {
    return { text: zeileErgebnis(e.vehicle.name, { ...e.importiert, neu: e.neu }), vehicle: e.vehicle };
  }
  const zeilen = e.fahrzeuge.map(f => zeileErgebnis(f.name, f));
  if (e.ohne_fahrzeug.fahrten || e.ohne_fahrzeug.protokoll) zeilen.push(zeileErgebnis("Ohne Fahrzeug", e.ohne_fahrzeug));
  return { text: zeilen.join("\n"), vehicle: null };
}
