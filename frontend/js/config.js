// js/config.js
// Empty = same origin; nginx in the frontend container forwards /api to the backend
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


// JWT payload (read only, no verification – the backend does that)
function tokenPayload() {
  try {
    const payload = localStorage.getItem("authToken").split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// Navigation: highlight the current page, show admin entries to admins only
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

  // Appearance: auto / light / dark (theme.js)
  const markiereDarstellung = () => document.querySelectorAll("[data-darstellung]").forEach(btn => {
    const aktiv = btn.dataset.darstellung === window.darstellung?.modus();
    btn.setAttribute("aria-checked", aktiv);
    btn.setAttribute("role", "menuitemradio");
    btn.querySelector(".darstellung-haken").style.visibility = aktiv ? "visible" : "hidden";
  });
  document.querySelectorAll("[data-darstellung]").forEach(btn => btn.addEventListener("click", () => {
    window.darstellung?.setze(btn.dataset.darstellung);
    markiereDarstellung();
  }));
  markiereDarstellung();
})();

// Trip types: value (as in the backend), key in totals, label,
// Bootstrap color (badges) and chart color. Fixed order = stacking order.
// Chart colors are CSS variables from theme.js (separate steps for light/dark,
// checked with the palette validator); in light mode commute has < 3:1 contrast
// → always paired with legend/labels and a table.
const FAHRTARTEN = [
  { wert: "business", key: "business", label: t("tripType.business"), farbe: "primary", chart: "var(--fa-business)" },
  { wert: "private",  key: "private",  label: t("tripType.private"),  farbe: "success", chart: "var(--fa-private)" },
  { wert: "commute",  key: "commute",  label: t("tripType.commute"),  farbe: "warning", chart: "var(--fa-commute)" },
];

// Display name of a country (ISO code from the profile)
const landName = code => (code ? t(`country.${code}`) : "–");

// Resolved color (for canvas charts, which don't understand CSS variables)
const cssFarbe = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fahrtartFarbe = art => cssFarbe(`--fa-${art.key}`);
const fahrtartInfo = wert => FAHRTARTEN.find(a => a.wert === wert) ?? { wert, label: wert, farbe: "secondary" };

function fahrtartOptionen(ausgewaehlt) {
  return FAHRTARTEN.map(a =>
    `<option value="${a.wert}" ${a.wert === ausgewaehlt ? "selected" : ""}>${a.label}</option>`).join("");
}

function fahrtartBadge(wert) {
  const a = fahrtartInfo(wert);
  return `<span class="badge text-bg-${a.farbe} card-badge">${escapeHtml(a.label)}</span>`;
}

// Percentage in the language's notation ("12,3 %" or "12.3%")
const prozentText = (zahl, stellen = 1) =>
  t("common.percent", { value: zahl.toLocaleString(i18n.locale, { maximumFractionDigits: stellen }) });

// Fills a <select> with "Automatic" + all languages (each in its own spelling);
// `beiAenderung` receives the code or null (= automatic)
function sprachAuswahl(select, beiAenderung, gewaehlt = i18n.gewaehlt()) {
  if (!select) return;
  select.innerHTML = [`<option value="">${escapeHtml(t("language.auto"))}</option>`,
    ...Object.entries(i18n.sprachen).map(([code, name]) => `<option value="${code}">${escapeHtml(name)}</option>`)].join("");
  select.value = gewaehlt ?? "";
  select.addEventListener("change", () => beiAenderung(select.value || null));
}

// Escapes HTML special characters before data is inserted via innerHTML
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Calls the API: sets the auth header, sends `body` as JSON and
// redirects to the login when the session has expired (401).
async function apiFetch(path, { method = "GET", body, headers = {} } = {}) {
  const authToken = localStorage.getItem("authToken");
  // Language for the backend's error messages, PDF and CSV
  const options   = { method, headers: { "Accept-Language": i18n.sprache, ...headers } };

  if (authToken) options.headers["Authorization"] = `Bearer ${authToken}`;
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, options);

  if (res.status === 401 && authToken) {
    localStorage.removeItem("authToken");
    window.location.href = "login.html?expired=1";
    return new Promise(() => {});  // stop further processing, the page is being left
  }
  return res;
}

// Reads the error message from an API response
async function apiError(res, fallback = t("common.unknownError")) {
  const data = await res.json().catch(() => ({}));
  return data.error || `${fallback} (${res.status})`;
}

// Fetches a file with the auth header and offers it as a download
// (a plain link would not send an Authorization header)
async function downloadDatei(path, dateiname) {
  try {
    const res = await apiFetch(path);
    if (!res.ok) return alert(await apiError(res, t("common.exportFailed")));

    const link = document.createElement("a");
    link.href = URL.createObjectURL(await res.blob());
    link.download = dateiname;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (err) {
    console.error("Export-Fehler:", err);
    alert(t("common.exportFailedDot"));
  }
}

// PWA: register the service worker for offline use
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err =>
      console.warn("Service Worker konnte nicht registriert werden:", err));
  });
}
