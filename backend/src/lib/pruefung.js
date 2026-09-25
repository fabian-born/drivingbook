// ============================================================
// Prüfung eines Jahres vor der Steuererklärung
// Markiert, was bei einer Betriebsprüfung auffallen könnte.
// Stufen: fehler (rot) · warnung (gelb) · hinweis (nur Info)
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
  const befund  = (stufe, typ, text, f) => befunde.push({
    stufe, typ, text,
    ...(f ? { fahrt_id: f.id, timestamp: f.timestamp, kmstand: f.kmstand } : {}),
  });

  for (const f of fahrten) {
    if (f.strecke != null && f.strecke < 0) {
      befund("fehler", "rueckschritt",
        `km-Stand ${km(f.kmstand)} ist ${km(-f.strecke)} kleiner als bei der vorherigen Fahrt.`, f);
    }
    if (new Date(f.timestamp) > jetzt) {
      befund("fehler", "zukunft", "Fahrt liegt in der Zukunft.", f);
    }

    const pause = f.vorher_timestamp ? (new Date(f.timestamp) - new Date(f.vorher_timestamp)) / TAG_MS : 0;
    if (pause > GRENZEN.pauseTage && f.strecke > GRENZEN.pauseKm) {
      befund("warnung", "luecke",
        `${Math.floor(pause)} Tage ohne Eintrag, dabei ${km(f.strecke)} gefahren – fehlen Fahrten?`, f);
    } else if (f.strecke > GRENZEN.grosseStrecke) {
      befund("warnung", "grosse_strecke",
        `${km(f.strecke)} seit der vorherigen Fahrt – fehlen dazwischen Fahrten?`, f);
    }

    if (KOORDINATEN.test(f.ziel)) {
      befund("warnung", "koordinaten", "Ziel ist nur eine Koordinate – bitte Adresse oder Kunde eintragen.", f);
    }
  }

  if (ohneFahrzeug > 0) {
    befund("warnung", "ohne_fahrzeug",
      `${ohneFahrzeug} Fahrt(en) in diesem Jahr sind keinem Fahrzeug zugeordnet.`);
  }
  if (geaendert > 0) {
    befund("hinweis", "geaendert",
      `${geaendert} Fahrt(en) wurden nachträglich geändert – nachvollziehbar im Änderungsprotokoll.`);
  }
  if (geloescht > 0) {
    befund("hinweis", "geloescht",
      `${geloescht} Fahrt(en) wurden gelöscht – nachvollziehbar im Änderungsprotokoll.`);
  }
  if (fahrten.length === 0) {
    befund("hinweis", "leer", "In diesem Jahr sind keine Fahrten erfasst.");
  }

  const ampel = befunde.some(b => b.stufe === "fehler") ? "rot"
    : befunde.some(b => b.stufe === "warnung") ? "gelb"
    : "gruen";

  return { ampel, befunde };
}
