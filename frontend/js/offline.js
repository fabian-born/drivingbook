// js/offline.js
// Warteschlange für offline erfasste Fahrten. Läuft auf jeder Seite:
// wartende Fahrten werden nachgereicht, sobald eine Verbindung besteht,
// und in der Navigation angezeigt.
//
// Jede Fahrt merkt sich den User, der sie erfasst hat – nach einem
// Benutzerwechsel auf demselben Gerät wird sie nicht unter falschem Konto gespeichert.

const WARTESCHLANGE_KEY = "offlineFahrten";

function angemeldeterUser() {
  return tokenPayload()?.userId ?? null;
}

function ladeWarteschlange() {
  try {
    return JSON.parse(localStorage.getItem(WARTESCHLANGE_KEY)) || [];
  } catch {
    return [];
  }
}

// Wartende Fahrten des angemeldeten Users (ältere Einträge ohne User gehören ihm)
function eigeneWartende() {
  const user = angemeldeterUser();
  return ladeWarteschlange().filter(f => f.userId == null || f.userId === user);
}

// Fahrten mit dauerhaftem Fehler (z. B. Fahrzeug inzwischen gelöscht) tragen
// `fehler` und werden übersprungen, bis der Nutzer sie erneut sendet oder verwirft –
// so blockiert eine fehlerhafte Fahrt nicht alle später erfassten.
const sendbar = f => !f.fehler;
const gleicheFahrt = (a, b) => a.timestamp === b.timestamp && a.userId === b.userId;

function aendereWartende(fahrt, aenderung) {
  speichereWarteschlange(ladeWarteschlange().flatMap(f => (gleicheFahrt(f, fahrt) ? aenderung(f) : [f])));
}

function verwerfeWartende(fahrt) {
  aendereWartende(fahrt, () => []);
}

function sendeWartendeErneut(fahrt) {
  aendereWartende(fahrt, ({ fehler, ...f }) => [f]);
  return synchronisiere();
}

function speichereWarteschlange(liste) {
  localStorage.setItem(WARTESCHLANGE_KEY, JSON.stringify(liste));
  aktualisiereWarteschlangeAnzeige();
}

function inWarteschlangeAufnehmen(fahrt) {
  speichereWarteschlange([...ladeWarteschlange(), { ...fahrt, userId: angemeldeterUser() }]);
}

// ── Anzeige ──────────────────────────────────────────────────

// Seiten können "warteschlange"-Events abfangen (preventDefault) und selbst anzeigen;
// sonst erscheint die Meldung als Hinweis oben rechts.
function meldeWarteschlange(text, typ = "success") {
  const event = new CustomEvent("warteschlange", { detail: { text, typ }, cancelable: true });
  if (!document.dispatchEvent(event)) return;

  let container = document.getElementById("hinweisContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "hinweisContainer";
    container.style.cssText = "position:fixed;top:1rem;right:1rem;z-index:9999;min-width:280px;";
    document.body.appendChild(container);
  }
  const div = document.createElement("div");
  div.className = `alert alert-${typ} alert-dismissible fade show shadow`;
  div.innerHTML = `${escapeHtml(text)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), 8000);
}

// Hinweis in der Navigation; Klick sendet sofort
function aktualisiereWarteschlangeAnzeige() {
  const alle       = eigeneWartende();
  const fehlerhaft = alle.filter(f => !sendbar(f));
  const anzahl     = alle.length - fehlerhaft.length;
  const logoutBtn = document.getElementById("logoutBtn");

  let btn = document.getElementById("warteschlangeNav");
  if (!btn && logoutBtn) {
    btn = document.createElement("button");
    btn.id        = "warteschlangeNav";
    btn.type      = "button";
    btn.className = "btn btn-warning btn-sm ms-lg-2 my-2 my-lg-0";
    btn.title     = "Offline erfasste Fahrten";
    // Fehlerhafte Fahrten lassen sich auf "Neue Fahrt" prüfen, sonst sofort senden
    btn.addEventListener("click", () => {
      if (eigeneWartende().some(f => !sendbar(f)) && !location.pathname.endsWith("driving.html")) {
        location.href = "driving.html";
      } else {
        synchronisiere();
      }
    });
    logoutBtn.parentElement.insertBefore(btn, document.getElementById("fahrzeugKontext") ?? logoutBtn);
  }
  if (btn) {
    btn.textContent = [anzahl ? `📴 ${anzahl} wartend` : "", fehlerhaft.length ? `⚠️ ${fehlerhaft.length} fehlerhaft` : ""]
      .filter(Boolean).join(" · ");
    btn.classList.toggle("d-none", alle.length === 0);
  }

  document.dispatchEvent(new CustomEvent("warteschlangeGeaendert", { detail: { anzahl, fehlerhaft } }));
}

// ── Senden ───────────────────────────────────────────────────

// Sendet eine Fahrt; fragt bei unplausiblem km-Stand nach.
// Ergebnis: "ok" | "abgelehnt" (Nutzer hat abgebrochen) | "fehler" (Validierung o. ä.)
// Netzwerkfehler werden als Exception weitergereicht.
async function sendeFahrt(fahrt, hinweis = "") {
  let res = await apiFetch("/api/fahrt", { method: "POST", body: fahrt });

  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    if (err.code !== "KM_PLAUSIBILITY") return { status: "fehler", meldung: err.error };
    if (!confirm(`${hinweis}${err.error}\n\nTrotzdem speichern?`)) return { status: "abgelehnt" };
    res = await apiFetch("/api/fahrt", { method: "POST", body: { ...fahrt, force: true } });
  }

  if (!res.ok) return { status: "fehler", meldung: await apiError(res, "Fehler beim Speichern") };
  return { status: "ok" };
}

let syncLaeuft = false;

// Reicht die wartenden Fahrten des angemeldeten Users der Reihe nach ein
async function synchronisiere() {
  if (syncLaeuft || !navigator.onLine || !localStorage.getItem("authToken")) return;
  syncLaeuft = true;

  try {
    let gesendet = 0;

    for (const fahrt of eigeneWartende().filter(sendbar)) {
      const datum = new Date(fahrt.timestamp).toLocaleString("de-DE");
      const { userId, fehler, ...body } = fahrt;
      let ergebnis;
      try {
        ergebnis = await sendeFahrt(body, `Offline erfasste Fahrt vom ${datum}:\n`);
      } catch {
        break;  // wieder offline → später erneut versuchen
      }

      if (ergebnis.status !== "ok") {
        // Dauerhaft nicht speicherbar oder km-Stand nicht bestätigt → markieren und
        // mit den übrigen Fahrten weitermachen (bleibt zum Prüfen in der Warteschlange)
        const meldung = ergebnis.status === "fehler"
          ? ergebnis.meldung || "Unbekannter Fehler"
          : "km-Stand unplausibel – Speichern nicht bestätigt";
        aendereWartende(fahrt, f => [{ ...f, fehler: meldung }]);
        meldeWarteschlange(`Offline erfasste Fahrt vom ${datum} konnte nicht gespeichert werden: ${meldung}`, "danger");
        continue;
      }

      // Neu laden statt Index merken – die Liste kann sich in einem anderen Tab geändert haben
      speichereWarteschlange(ladeWarteschlange().filter(f => f.timestamp !== fahrt.timestamp || f.userId !== fahrt.userId));
      gesendet++;
    }

    if (gesendet > 0) {
      meldeWarteschlange(`✅ ${gesendet} offline erfasste Fahrt(en) nachträglich gespeichert.`);
      // Seiten mit Auswertungen laden daraufhin ihre Daten neu
      document.dispatchEvent(new CustomEvent("fahrtenNachgereicht", { detail: { gesendet } }));
    }
  } finally {
    syncLaeuft = false;
    aktualisiereWarteschlangeAnzeige();
  }
}

window.addEventListener("online", synchronisiere);
aktualisiereWarteschlangeAnzeige();

// Seiten warten vor dem Laden ihrer Daten darauf, damit nachgereichte Fahrten schon enthalten sind
const ersteSynchronisierung = synchronisiere();

// ── Ansicht aktualisieren ────────────────────────────────────
// Seiten registrieren hier, wie sie ihre Daten neu laden. Ausgelöst wird
// nach nachgereichten Offline-Fahrten, beim Zurückwechseln in die App/den
// Tab (nach > 30 s) und alle 5 Minuten, solange die Seite sichtbar ist –
// so erscheinen z. B. Fahrten aus Home Assistant ohne Neuladen.
// Während einer Eingabe wird bis zum Verlassen des Feldes gewartet.

const AKTUALISIEREN_NACH_MS = 30 * 1000;
const AKTUALISIEREN_ALLE_MS = 5 * 60 * 1000;
const aktualisierer = [];

function beiAktualisierung(fn) {
  aktualisierer.push(fn);
}

function wirdBearbeitet() {
  const el = document.activeElement;
  return el && el.matches?.("input:not([type=button]):not([type=submit]), select, textarea, [contenteditable=true]");
}

let aktualisierungWartet = false;
let aktualisierungGeplant = null;

// Mehrere Auslöser kurz hintereinander (z. B. Nachreichen + Rückkehr) → einmal laden
function aktualisiereAnsicht() {
  clearTimeout(aktualisierungGeplant);
  aktualisierungGeplant = setTimeout(fuehreAktualisierungAus, 300);
}

function fuehreAktualisierungAus() {
  if (aktualisierer.length === 0 || document.hidden) return;
  if (wirdBearbeitet()) {
    if (aktualisierungWartet) return;
    aktualisierungWartet = true;
    document.activeElement.addEventListener("blur", () => {
      aktualisierungWartet = false;
      setTimeout(fuehreAktualisierungAus, 500);   // gespeicherte Änderung abwarten
    }, { once: true });
    return;
  }
  for (const fn of aktualisierer) Promise.resolve().then(fn).catch(err => console.warn("Aktualisieren:", err));
}

document.addEventListener("fahrtenNachgereicht", aktualisiereAnsicht);

let verstecktSeit = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    verstecktSeit = Date.now();
    return;
  }
  const lange = verstecktSeit && Date.now() - verstecktSeit > AKTUALISIEREN_NACH_MS;
  verstecktSeit = null;
  if (lange) synchronisiere().finally(aktualisiereAnsicht);
});

setInterval(() => { if (!document.hidden) aktualisiereAnsicht(); }, AKTUALISIEREN_ALLE_MS);
