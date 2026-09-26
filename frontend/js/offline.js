// js/offline.js
// Queue for trips recorded offline. Runs on every page:
// pending trips are sent later as soon as a connection is available,
// and shown in the navigation.
//
// Each trip remembers the user who recorded it – after a user switch
// on the same device it is not saved under the wrong account.

const WARTESCHLANGE_KEY = "offlineFahrten";

function angemeldeterUser() {
  return tokenPayload()?.userId ?? null;
}

// Rewrite entries from app versions before the English API (kmstand/ziel/fahrtart)
// into the current format – they may still be stored on the device
const ALTE_FAHRTARTEN = { privat: "private", "geschäftlich": "business", arbeitsweg: "commute" };
function neuesFormat(f) {
  if (!("kmstand" in f) && !("ziel" in f) && !("fahrtart" in f)) return f;
  const { kmstand, ziel, fahrtart, ...rest } = f;
  return { ...rest, odometer_km: kmstand, destination: ziel, trip_type: ALTE_FAHRTARTEN[fahrtart] ?? fahrtart };
}

function ladeWarteschlange() {
  try {
    return (JSON.parse(localStorage.getItem(WARTESCHLANGE_KEY)) || []).map(neuesFormat);
  } catch {
    return [];
  }
}

// Pending trips of the logged-in user (older entries without a user belong to them)
function eigeneWartende() {
  const user = angemeldeterUser();
  return ladeWarteschlange().filter(f => f.userId == null || f.userId === user);
}

// Trips with a permanent error (e.g. vehicle deleted in the meantime) carry
// `fehler` and are skipped until the user resends or discards them –
// so one faulty trip doesn't block all trips recorded after it.
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

// ── Display ──────────────────────────────────────────────────

// Pages can intercept "warteschlange" events (preventDefault) and display them themselves;
// otherwise the message appears as a top-right notice.
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

// Notice in the navigation; click sends immediately
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
    btn.title     = t("offline.queueTitle");
    // Faulty trips can be reviewed on "New trip", otherwise send immediately
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
    btn.textContent = [anzahl ? t("offline.waiting", { count: anzahl }) : "", fehlerhaft.length ? t("offline.faulty", { count: fehlerhaft.length }) : ""]
      .filter(Boolean).join(" · ");
    btn.classList.toggle("d-none", alle.length === 0);
  }

  document.dispatchEvent(new CustomEvent("warteschlangeGeaendert", { detail: { anzahl, fehlerhaft } }));
}

// ── Send ─────────────────────────────────────────────────────

// Sends a trip; asks for confirmation on an implausible odometer reading.
// Result: "ok" | "abgelehnt" (user cancelled) | "fehler" (validation etc.)
// Network errors are propagated as exceptions.
async function sendeFahrt(fahrt, hinweis = "") {
  let res = await apiFetch("/api/trips", { method: "POST", body: fahrt });

  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    if (err.code !== "KM_PLAUSIBILITY") return { status: "fehler", meldung: err.error };
    if (!confirm(`${hinweis}${err.error}\n\n${t("offline.saveAnyway")}`)) return { status: "abgelehnt" };
    res = await apiFetch("/api/trips", { method: "POST", body: { ...fahrt, force: true } });
  }

  if (!res.ok) return { status: "fehler", meldung: await apiError(res, t("common.saveError")) };
  return { status: "ok" };
}

let syncLaeuft = false;

// Sends the logged-in user's pending trips one after another
async function synchronisiere() {
  if (syncLaeuft || !navigator.onLine || !localStorage.getItem("authToken")) return;
  syncLaeuft = true;

  try {
    let gesendet = 0;

    for (const fahrt of eigeneWartende().filter(sendbar)) {
      const datum = new Date(fahrt.timestamp).toLocaleString(i18n.locale);
      const { userId, fehler, ...body } = fahrt;
      let ergebnis;
      try {
        ergebnis = await sendeFahrt(body, `${t("offline.tripFrom", { date: datum })}\n`);
      } catch {
        break;  // offline again → retry later
      }

      if (ergebnis.status !== "ok") {
        // Permanently unsaveable or odometer reading not confirmed → mark it and
        // continue with the remaining trips (stays in the queue for review)
        const meldung = ergebnis.status === "fehler"
          ? ergebnis.meldung || t("common.unknownError")
          : t("offline.notConfirmed");
        aendereWartende(fahrt, f => [{ ...f, fehler: meldung }]);
        meldeWarteschlange(t("offline.couldNotSave", { date: datum, message: meldung }), "danger");
        continue;
      }

      // Reload instead of keeping the index – the list may have changed in another tab
      speichereWarteschlange(ladeWarteschlange().filter(f => f.timestamp !== fahrt.timestamp || f.userId !== fahrt.userId));
      gesendet++;
    }

    if (gesendet > 0) {
      meldeWarteschlange(t("offline.sent", { count: gesendet }));
      // Pages with analyses then reload their data
      document.dispatchEvent(new CustomEvent("fahrtenNachgereicht", { detail: { gesendet } }));
    }
  } finally {
    syncLaeuft = false;
    aktualisiereWarteschlangeAnzeige();
  }
}

window.addEventListener("online", synchronisiere);
aktualisiereWarteschlangeAnzeige();

// Pages await this before loading their data so trips sent later are already included
const ersteSynchronisierung = synchronisiere();

// ── Refresh view ─────────────────────────────────────────────
// Pages register here how they reload their data. Triggered
// after offline trips were sent later, when switching back to the app/tab
// (after > 30 s) and every 5 minutes while the page is visible –
// so e.g. trips from Home Assistant appear without reloading.
// During input, it waits until the field loses focus.

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

// Several triggers in quick succession (e.g. send later + return) → load once
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
      setTimeout(fuehreAktualisierungAus, 500);   // wait for the saved change
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
