// js/offline.js
// Queue for trips recorded offline. Runs on every page:
// pending trips are sent later as soon as a connection is available,
// and shown in the navigation.
//
// Each trip remembers the user who recorded it – after a user switch
// on the same device it is not saved under the wrong account.

const QUEUE_KEY = "offlineFahrten";

function loggedInUser() {
  return tokenPayload()?.userId ?? null;
}

// Rewrite entries from app versions before the English API (kmstand/ziel/fahrtart)
// into the current format – they may still be stored on the device
const LEGACY_TRIP_TYPES = { privat: "private", "geschäftlich": "business", arbeitsweg: "commute" };
function migrateFormat(f) {
  if (!("kmstand" in f) && !("ziel" in f) && !("fahrtart" in f)) return f;
  const { kmstand: odometer, ziel: target, fahrtart: tripType, ...rest } = f;
  return { ...rest, odometer_km: odometer, destination: target, trip_type: LEGACY_TRIP_TYPES[tripType] ?? tripType };
}

function loadQueue() {
  try {
    return (JSON.parse(localStorage.getItem(QUEUE_KEY)) || []).map(migrateFormat);
  } catch {
    return [];
  }
}

// Pending trips of the logged-in user (older entries without a user belong to them)
function ownPending() {
  const user = loggedInUser();
  return loadQueue().filter(f => f.userId == null || f.userId === user);
}

// Trips with a permanent error (e.g. vehicle deleted in the meantime) carry
// `fehler` and are skipped until the user resends or discards them –
// so one faulty trip doesn't block all trips recorded after it.
const isSendable = f => !f.fehler;
const sameTrip = (a, b) => a.timestamp === b.timestamp && a.userId === b.userId;

function updatePending(trip, modifier) {
  saveQueue(loadQueue().flatMap(f => (sameTrip(f, trip) ? modifier(f) : [f])));
}

function discardPending(trip) {
  updatePending(trip, () => []);
}

function resendPending(trip) {
  updatePending(trip, ({ fehler: failure, ...f }) => [f]);
  return synchronize();
}

function saveQueue(listEl) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(listEl));
  updateQueueDisplay();
}

function enqueueTrip(trip) {
  saveQueue([...loadQueue(), { ...trip, userId: loggedInUser() }]);
}

// ── Display ──────────────────────────────────────────────────

// Pages can intercept "warteschlange" events (preventDefault) and display them themselves;
// otherwise the message appears as a top-right notice.
function notifyQueue(text, type = "success") {
  const event = new CustomEvent("warteschlange", { detail: { text, type: type }, cancelable: true });
  if (!document.dispatchEvent(event)) return;

  let container = document.getElementById("hinweisContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "hinweisContainer";
    container.style.cssText = "position:fixed;top:1rem;right:1rem;z-index:9999;min-width:280px;";
    document.body.appendChild(container);
  }
  const div = document.createElement("div");
  div.className = `alert alert-${type} alert-dismissible fade show shadow`;
  div.innerHTML = `${escapeHtml(text)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), 8000);
}

// Notice in the navigation; click sends immediately
function updateQueueDisplay() {
  const allPending       = ownPending();
  const failed = allPending.filter(f => !isSendable(f));
  const count     = allPending.length - failed.length;
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
      if (ownPending().some(f => !isSendable(f)) && !location.pathname.endsWith("driving.html")) {
        location.href = "driving.html";
      } else {
        synchronize();
      }
    });
    logoutBtn.parentElement.insertBefore(btn, document.getElementById("fahrzeugKontext") ?? logoutBtn);
  }
  if (btn) {
    btn.textContent = [count ? t("offline.waiting", { count: count }) : "", failed.length ? t("offline.faulty", { count: failed.length }) : ""]
      .filter(Boolean).join(" · ");
    btn.classList.toggle("d-none", allPending.length === 0);
  }

  document.dispatchEvent(new CustomEvent("warteschlangeGeaendert", { detail: { count: count, failed: failed } }));
}

// ── Send ─────────────────────────────────────────────────────

// Sends a trip; asks for confirmation on an implausible odometer reading.
// Result: "ok" | "abgelehnt" (user cancelled) | "fehler" (validation etc.)
// Network errors are propagated as exceptions.
async function sendTrip(trip, hint = "") {
  let res = await apiFetch("/api/trips", { method: "POST", body: trip });

  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    if (err.code !== "KM_PLAUSIBILITY") return { status: "fehler", message: err.error };
    if (!confirm(`${hint}${err.error}\n\n${t("offline.saveAnyway")}`)) return { status: "abgelehnt" };
    res = await apiFetch("/api/trips", { method: "POST", body: { ...trip, force: true } });
  }

  if (!res.ok) return { status: "fehler", message: await apiError(res, t("common.saveError")) };
  return { status: "ok" };
}

let syncRunning = false;

// Sends the logged-in user's pending trips one after another
async function synchronize() {
  if (syncRunning || !navigator.onLine || !localStorage.getItem("authToken")) return;
  syncRunning = true;

  try {
    let sentCount = 0;

    for (const trip of ownPending().filter(isSendable)) {
      const localDate = new Date(trip.timestamp).toLocaleString(i18n.locale);
      const { userId, fehler: failure, ...body } = trip;
      let result;
      try {
        result = await sendTrip(body, `${t("offline.tripFrom", { date: localDate })}\n`);
      } catch {
        break;  // offline again → retry later
      }

      if (result.status !== "ok") {
        // Permanently unsaveable or odometer reading not confirmed → mark it and
        // continue with the remaining trips (stays in the queue for review)
        const message = result.status === "fehler"
          ? result.message || t("common.unknownError")
          : t("offline.notConfirmed");
        updatePending(trip, f => [{ ...f, fehler: message }]);
        notifyQueue(t("offline.couldNotSave", { date: localDate, message: message }), "danger");
        continue;
      }

      // Reload instead of keeping the index – the list may have changed in another tab
      saveQueue(loadQueue().filter(f => f.timestamp !== trip.timestamp || f.userId !== trip.userId));
      sentCount++;
    }

    if (sentCount > 0) {
      notifyQueue(t("offline.sent", { count: sentCount }));
      // Pages with analyses then reload their data
      document.dispatchEvent(new CustomEvent("fahrtenNachgereicht", { detail: { sent: sentCount } }));
    }
  } finally {
    syncRunning = false;
    updateQueueDisplay();
  }
}

window.addEventListener("online", synchronize);
updateQueueDisplay();

// Pages await this before loading their data so trips sent later are already included
const initialSync = synchronize();

// ── Refresh view ─────────────────────────────────────────────
// Pages register here how they reload their data. Triggered
// after offline trips were sent later, when switching back to the app/tab
// (after > 30 s) and every 5 minutes while the page is visible –
// so e.g. trips from Home Assistant appear without reloading.
// During input, it waits until the field loses focus.

const REFRESH_AFTER_HIDDEN_MS = 30 * 1000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const refreshers = [];

function onRefresh(fn) {
  refreshers.push(fn);
}

function isEditing() {
  const el = document.activeElement;
  return el && el.matches?.("input:not([type=button]):not([type=submit]), select, textarea, [contenteditable=true]");
}

let refreshDeferred = false;
let refreshScheduled = null;

// Several triggers in quick succession (e.g. send later + return) → load once
function refreshView() {
  clearTimeout(refreshScheduled);
  refreshScheduled = setTimeout(runRefresh, 300);
}

function runRefresh() {
  if (refreshers.length === 0 || document.hidden) return;
  if (isEditing()) {
    if (refreshDeferred) return;
    refreshDeferred = true;
    document.activeElement.addEventListener("blur", () => {
      refreshDeferred = false;
      setTimeout(runRefresh, 500);   // wait for the saved change
    }, { once: true });
    return;
  }
  for (const fn of refreshers) Promise.resolve().then(fn).catch(err => console.warn("Aktualisieren:", err));
}

document.addEventListener("fahrtenNachgereicht", refreshView);

let hiddenSince = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenSince = Date.now();
    return;
  }
  const hiddenLong = hiddenSince && Date.now() - hiddenSince > REFRESH_AFTER_HIDDEN_MS;
  hiddenSince = null;
  if (hiddenLong) synchronize().finally(refreshView);
});

setInterval(() => { if (!document.hidden) refreshView(); }, REFRESH_INTERVAL_MS);
