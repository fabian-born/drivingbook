// js/driving-new.js
// Neue Fahrt erfassen – auch offline: Fahrten ohne Verbindung landen in der
// Warteschlange (offline.js) und werden automatisch nachgereicht.

const $ = id => document.getElementById(id);
const LETZTER_STAND_KEY = code => `letzterStand:${code}`;   // für den Hinweis auch offline

let letzterStand = null;   // { km, zeit } der letzten Fahrt des aktiven Fahrzeugs

// ── Fahrzeug & letzter Stand ─────────────────────────────────
// Neue Fahrten gehören immer zum aktiven Fahrzeug aus der Navigation.

function relativeZeit(iso) {
  const rtf  = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  const diff = new Date(iso) - new Date();
  const tage = Math.round(diff / 86400e3);
  if (Math.abs(tage) >= 1) return rtf.format(tage, "day");
  const stunden = Math.round(diff / 3600e3);
  return Math.abs(stunden) >= 1 ? rtf.format(stunden, "hour") : "gerade eben";
}

function merkeLetztenStand(code, stand) {
  letzterStand = stand;
  try { localStorage.setItem(LETZTER_STAND_KEY(code), JSON.stringify(stand)); } catch { /* optional */ }
  zeigeLetztenStand();
}

function zeigeLetztenStand() {
  $("letzterStand").textContent = letzterStand
    ? `Letzter Stand ${letzterStand.km.toLocaleString("de-DE")} km · ${relativeZeit(letzterStand.zeit)}`
    : "Noch keine Fahrt erfasst";
  $("kmstand").placeholder = letzterStand ? String(letzterStand.km) : "0";
  aktualisiereKmHinweis();
}

async function zeigeFahrzeug() {
  const vehicle = await fahrzeugBereit;
  if (!vehicle) {
    $("fahrzeugName").textContent = "Kein Fahrzeug";
    $("letzterStand").textContent = "Fahrzeuge verwaltest du unter Profil → Auto-Info";
    return;   // Backend speichert ohne Zuordnung
  }

  $("fahrzeugName").textContent = vehicle.name;
  $("fahrzeugKennzeichen").textContent = vehicle.license_plate ?? "";
  $("fahrzeugKennzeichen").classList.toggle("d-none", !vehicle.license_plate);

  try {
    letzterStand = JSON.parse(localStorage.getItem(LETZTER_STAND_KEY(vehicle.code)));
  } catch { letzterStand = null; }
  zeigeLetztenStand();

  try {
    const res = await apiFetch(`/api/vehicles/${vehicle.id}/info`);
    if (!res.ok) return;
    const { gesamt } = await res.json();
    merkeLetztenStand(vehicle.code, gesamt.km_aktuell != null
      ? { km: gesamt.km_aktuell, zeit: gesamt.letzte_fahrt }
      : null);
  } catch { /* offline → zuletzt bekannter Stand */ }
}

// Live-Hinweis unter dem km-Feld: Differenz zur letzten Fahrt
function aktualisiereKmHinweis() {
  const hinweis = $("kmHinweis");
  const wert    = $("kmstand").value;
  hinweis.classList.remove("text-danger", "text-success");
  $("kmstand").classList.remove("is-invalid");

  if (!wert || !letzterStand) {
    hinweis.innerHTML = "&nbsp;";
    return;
  }
  const diff = Number(wert) - letzterStand.km;
  if (diff < 0) {
    hinweis.textContent = `Kleiner als der letzte Stand (${letzterStand.km.toLocaleString("de-DE")} km)`;
    hinweis.classList.add("text-danger");
    $("kmstand").classList.add("is-invalid");
  } else {
    hinweis.textContent = `+${diff.toLocaleString("de-DE")} km seit der letzten Fahrt`;
    hinweis.classList.add("text-success");
  }
}

// ── Standort ─────────────────────────────────────────────────

function holeStandort() {
  if (!navigator.geolocation) return zeigeStatus("Standortbestimmung wird nicht unterstützt.", "warning");
  const btn = $("standortBtn");
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    async position => {
      await uebernehmePosition(position);
      btn.disabled = false;
    },
    error => {
      const msgs = ["Zugriff auf den Standort verweigert", "Position nicht verfügbar", "Zeitüberschreitung"];
      zeigeStatus(msgs[error.code - 1] || "Standort unbekannt", "warning");
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function uebernehmePosition(position) {
  const lat = position.coords.latitude.toFixed(6);
  const lon = position.coords.longitude.toFixed(6);
  const zielFeld = $("ziel");

  // Offline: Koordinaten eintragen – das Backend löst sie beim Speichern in eine Adresse auf
  if (!navigator.onLine) {
    zielFeld.value = `${lat}, ${lon}`;
    return;
  }

  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`);
    const addr = (await res.json()).address || {};
    const strasse = [addr.road, addr.house_number].filter(Boolean).join(" ");
    const ort     = [addr.postcode, addr.city || addr.town || addr.village].filter(Boolean).join(" ");
    zielFeld.value = [strasse, ort].filter(Boolean).join(", ") || `${lat}, ${lon}`;
  } catch (err) {
    console.error("Standort:", err);
    zielFeld.value = `${lat}, ${lon}`;
  }
}

// ── Statusanzeige ────────────────────────────────────────────

function zeigeStatus(text, typ = "success") {
  const box = $("statusMeldung");
  box.className   = `alert alert-${typ}`;
  box.textContent = text;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ── Offline-Warteschlange ────────────────────────────────────

function aktualisiereOfflineHinweis(anzahl, fehlerhaft = []) {
  $("offlineHinweis").classList.toggle("d-none", anzahl === 0);
  $("offlineAnzahl").textContent = anzahl === 1 ? "1 Fahrt wartet" : `${anzahl} Fahrten warten`;

  $("offlineFehler").classList.toggle("d-none", fehlerhaft.length === 0);
  $("offlineFehlerListe").innerHTML = fehlerhaft.map((f, i) => `
    <li class="border-top border-danger-subtle pt-2">
      <div class="small"><strong>${escapeHtml(new Date(f.timestamp).toLocaleString("de-DE"))}</strong> ·
        ${escapeHtml(Number(f.kmstand).toLocaleString("de-DE"))} km · ${escapeHtml(f.ziel)}</div>
      <div class="small text-danger-emphasis mb-1">${escapeHtml(f.fehler)}</div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-sm btn-outline-danger" data-erneut="${i}">Erneut senden</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-verwerfen="${i}">Verwerfen</button>
      </div>
    </li>`).join("");
  offlineFehlerAktuell = fehlerhaft;
}

let offlineFehlerAktuell = [];

// ── Erfassen ─────────────────────────────────────────────────

function formularLeeren() {
  $("kmstand").value = "";
  $("ziel").value = "";
  aktualisiereKmHinweis();
}

// Nach dem Speichern (oder Einreihen) gilt der neue Stand als letzter Stand
function erfasst(fahrt) {
  if (aktivesFahrzeug) merkeLetztenStand(aktivesFahrzeug.code, { km: Number(fahrt.kmstand), zeit: fahrt.timestamp });
  formularLeeren();
}

function inWarteschlange(fahrt) {
  inWarteschlangeAufnehmen(fahrt);
  erfasst(fahrt);
  zeigeStatus("📴 Keine Verbindung – Fahrt lokal gespeichert. Sie wird automatisch übertragen, sobald du wieder online bist.", "warning");
}

function setzeSpeichern(aktiv) {
  $("speichernBtn").disabled = aktiv;
  $("speichernSpinner").classList.toggle("d-none", !aktiv);
}

async function addFahrt() {
  const kmstand  = $("kmstand").value;
  const ziel     = $("ziel").value.trim();
  const fahrtart = document.querySelector('input[name="fahrtart"]:checked')?.value;

  if (!kmstand || !ziel || !fahrtart) {
    (kmstand ? $("ziel") : $("kmstand")).focus();
    return zeigeStatus("Bitte km-Stand und Ziel eintragen.", "warning");
  }

  // Zeitpunkt wird bei der Erfassung festgehalten, auch wenn erst später gesendet wird
  const fahrt = { kmstand, ziel, fahrtart, timestamp: new Date().toISOString() };

  // Code wird bei der Erfassung festgehalten, auch wenn offline erst später gesendet wird
  const vehicle = await fahrzeugBereit;
  if (vehicle) fahrt.vehicle_code = vehicle.code;

  if (!navigator.onLine) return inWarteschlange(fahrt);

  setzeSpeichern(true);   // verhindert Doppel-Einträge durch Doppeltippen
  try {
    const ergebnis = await sendeFahrt(fahrt);
    if (ergebnis.status === "ok") {
      erfasst(fahrt);
      zeigeStatus("✅ Fahrt gespeichert!");
    } else if (ergebnis.status === "fehler") {
      zeigeStatus(ergebnis.meldung, "danger");
    }
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
    inWarteschlange(fahrt);  // Netzwerkfehler → offline behandeln
  } finally {
    setzeSpeichern(false);
  }
}

// ── Start ────────────────────────────────────────────────────

// Meldungen der Warteschlange im Formular statt als Hinweis oben rechts anzeigen
document.addEventListener("warteschlange", e => {
  e.preventDefault();
  zeigeStatus(e.detail.text, e.detail.typ);
});
document.addEventListener("warteschlangeGeaendert", e => aktualisiereOfflineHinweis(e.detail.anzahl, e.detail.fehlerhaft));

document.addEventListener("DOMContentLoaded", () => {
  aktualisiereWarteschlangeAnzeige();
  $("offlineFehlerListe").addEventListener("click", e => {
    const erneut    = e.target.closest("[data-erneut]");
    const verwerfen = e.target.closest("[data-verwerfen]");
    if (erneut) sendeWartendeErneut(offlineFehlerAktuell[erneut.dataset.erneut]);
    if (verwerfen && confirm("Diese Fahrt endgültig verwerfen? Sie wird nicht gespeichert.")) {
      verwerfeWartende(offlineFehlerAktuell[verwerfen.dataset.verwerfen]);
    }
  });
  $("syncJetzt").addEventListener("click", synchronisiere);
  $("standortBtn").addEventListener("click", holeStandort);
  $("kmstand").addEventListener("input", aktualisiereKmHinweis);
  $("fahrtFormular").addEventListener("submit", e => {
    e.preventDefault();
    addFahrt();
  });
  zeigeFahrzeug();
  beiAktualisierung(zeigeFahrzeug);   // letzten km-Stand auffrischen
});
