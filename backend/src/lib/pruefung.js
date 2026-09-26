// ============================================================
// Prüfung eines Jahres vor der Steuererklärung
// Markiert, was bei einer Betriebsprüfung auffallen könnte.
// Stufen (level): error (rot) · warning (gelb) · info (nur Hinweis)
// Ergebnis: { status: "green" | "yellow" | "red", findings: [...] }
// ============================================================

export const GRENZEN = {
  grosseStrecke: 1000,  // km zwischen zwei Fahrten
  pauseTage:     30,    // Tage ohne Fahrt …
  pauseKm:       300,   // … bei gleichzeitig so vielen gefahrenen km
};

const KOORDINATEN = /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/;
const TAG_MS = 24 * 60 * 60 * 1000;

const km = n => `${n.toLocaleString("de-DE")} km`;

// fahrten: aus jahresFahrten() (ein Fahrzeug)
// extra:   { geaendert, geloescht, ohneFahrzeug, jetzt }
export function pruefeJahr(fahrten, { geaendert = 0, geloescht = 0, ohneFahrzeug = 0, jetzt = new Date() } = {}) {
  const befunde = [];
  const befund  = (level, type, text, f) => befunde.push({
    level, type, text,
    ...(f ? { trip_id: f.id, timestamp: f.timestamp, odometer_km: f.odometer_km } : {}),
  });

  for (const f of fahrten) {
    if (f.distance != null && f.distance < 0) {
      befund("error", "odometer_decrease",
        `km-Stand ${km(f.odometer_km)} ist ${km(-f.distance)} kleiner als bei der vorherigen Fahrt.`, f);
    }
    if (new Date(f.timestamp) > jetzt) {
      befund("error", "future", "Fahrt liegt in der Zukunft.", f);
    }

    const pause = f.previous_timestamp ? (new Date(f.timestamp) - new Date(f.previous_timestamp)) / TAG_MS : 0;
    if (pause > GRENZEN.pauseTage && f.distance > GRENZEN.pauseKm) {
      befund("warning", "gap",
        `${Math.floor(pause)} Tage ohne Eintrag, dabei ${km(f.distance)} gefahren – fehlen Fahrten?`, f);
    } else if (f.distance > GRENZEN.grosseStrecke) {
      befund("warning", "long_distance",
        `${km(f.distance)} seit der vorherigen Fahrt – fehlen dazwischen Fahrten?`, f);
    }

    if (KOORDINATEN.test(f.destination)) {
      befund("warning", "coordinates", "Ziel ist nur eine Koordinate – bitte Adresse oder Kunde eintragen.", f);
    }
  }

  if (ohneFahrzeug > 0) {
    befund("warning", "unassigned",
      `${ohneFahrzeug} Fahrt(en) in diesem Jahr sind keinem Fahrzeug zugeordnet.`);
  }
  if (geaendert > 0) {
    befund("info", "edited",
      `${geaendert} Fahrt(en) wurden nachträglich geändert – nachvollziehbar im Änderungsprotokoll.`);
  }
  if (geloescht > 0) {
    befund("info", "deleted",
      `${geloescht} Fahrt(en) wurden gelöscht – nachvollziehbar im Änderungsprotokoll.`);
  }
  if (fahrten.length === 0) {
    befund("info", "empty", "In diesem Jahr sind keine Fahrten erfasst.");
  }

  const status = befunde.some(b => b.level === "error") ? "red"
    : befunde.some(b => b.level === "warning") ? "yellow"
    : "green";

  return { status, findings: befunde };
}
