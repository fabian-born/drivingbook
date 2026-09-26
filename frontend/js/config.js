// js/config.js
// Leer = gleiche Origin; nginx im Frontend-Container leitet /api ans Backend weiter
const API_BASE_URL = "";
//const API_BASE_URL = "http://192.168.4.249:3000"
const START_JAHR = 2024;


const logoutBtn = document.getElementById("logoutBtn");

logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem("authToken");
  localStorage.removeItem("aktivesFahrzeug");
  localStorage.removeItem("fahrzeuge");
  window.location.href = "login.html";
});


// Inhalt des JWT (nur lesen, keine Prüfung – die macht das Backend)
function tokenPayload() {
  try {
    const payload = localStorage.getItem("authToken").split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// Navigation: aktuelle Seite markieren, Admin-Einträge nur für Admins zeigen
(function initNavigation() {
  const seite = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".navbar-nav a[href]").forEach(link => {
    if (link.getAttribute("href") !== seite) return;
    link.classList.add("active");
    link.setAttribute("aria-current", "page");
    link.closest(".dropdown")?.querySelector(".dropdown-toggle").classList.add("active");
  });
  if (tokenPayload()?.role === "admin") {
    document.querySelectorAll(".nav-admin").forEach(el => el.classList.remove("d-none"));
  }
})();

// Fahrtarten: Wert (wie im Backend), Schlüssel in Summen, Beschriftung,
// Bootstrap-Farbe (Badges) und Diagrammfarbe. Feste Reihenfolge = Stapelreihenfolge.
// Diagrammfarben mit dem Palette-Validator geprüft (Farbfehlsichtigkeit ok);
// Arbeitsweg hat < 3:1 Kontrast → immer mit Legende/Beschriftung und Tabelle.
const FAHRTARTEN = [
  { wert: "geschäftlich", key: "geschaeftlich", label: "Geschäftlich", farbe: "primary", chart: "#0d6efd" },
  { wert: "privat",       key: "privat",        label: "Privat",       farbe: "success", chart: "#198754" },
  { wert: "arbeitsweg",   key: "arbeitsweg",    label: "Arbeitsweg",   farbe: "warning", chart: "#e08a00" },
];
const fahrtartInfo = wert => FAHRTARTEN.find(a => a.wert === wert) ?? { wert, label: wert, farbe: "secondary" };

function fahrtartOptionen(ausgewaehlt) {
  return FAHRTARTEN.map(a =>
    `<option value="${a.wert}" ${a.wert === ausgewaehlt ? "selected" : ""}>${a.label}</option>`).join("");
}

function fahrtartBadge(wert) {
  const a = fahrtartInfo(wert);
  return `<span class="badge text-bg-${a.farbe} card-badge">${escapeHtml(a.label)}</span>`;
}

// Maskiert HTML-Sonderzeichen, bevor Daten per innerHTML eingefügt werden
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Ruft die API auf: setzt den Auth-Header, sendet `body` als JSON und
// leitet bei abgelaufener Anmeldung (401) zum Login weiter.
async function apiFetch(path, { method = "GET", body, headers = {} } = {}) {
  const authToken = localStorage.getItem("authToken");
  const options   = { method, headers: { ...headers } };

  if (authToken) options.headers["Authorization"] = `Bearer ${authToken}`;
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, options);

  if (res.status === 401 && authToken) {
    localStorage.removeItem("authToken");
    window.location.href = "login.html?expired=1";
    return new Promise(() => {});  // Weiterverarbeitung abbrechen, Seite wird verlassen
  }
  return res;
}

// Liest die Fehlermeldung aus einer API-Antwort
async function apiError(res, fallback = "Unbekannter Fehler") {
  const data = await res.json().catch(() => ({}));
  return data.error || `${fallback} (${res.status})`;
}

// Lädt eine Datei mit Auth-Header und bietet sie als Download an
// (ein normaler Link würde keinen Authorization-Header mitschicken)
async function downloadDatei(path, dateiname) {
  try {
    const res = await apiFetch(path);
    if (!res.ok) return alert(await apiError(res, "Export fehlgeschlagen"));

    const link = document.createElement("a");
    link.href = URL.createObjectURL(await res.blob());
    link.download = dateiname;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (err) {
    console.error("Export-Fehler:", err);
    alert("Export fehlgeschlagen.");
  }
}

// PWA: Service Worker für Offline-Nutzung registrieren
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err =>
      console.warn("Service Worker konnte nicht registriert werden:", err));
  });
}
