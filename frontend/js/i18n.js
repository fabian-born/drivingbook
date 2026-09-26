// js/i18n.js
// Mehrsprachigkeit. Wird im <head> jeder Seite direkt nach theme.js geladen.
// Sprachdateien: lang/<sprache>.json im i18next-Format (verschachtelte Schlüssel,
// Platzhalter {{name}}, Mehrzahl als key_one / key_other).
// Die aktive Sprache wird synchron geladen, damit alle anderen Skripte t() sofort
// nutzen können; offline kommt sie aus dem Service-Worker-Cache.
//
//   t("nav.dashboard")                     → Text (für textContent, alert, confirm)
//   t("dashboard.trips", { count: 3 })     → Mehrzahl über Intl.PluralRules
//   tHtml("key", { name })                 → Parameter HTML-escaped (für innerHTML)
//   i18n.locale                            → z. B. "de-DE" für Datum und Zahlen
//
// HTML: data-i18n="key" (textContent), data-i18n-html="key" (eigenes Markup),
//       data-i18n-attr="placeholder:key;title:key2" (Attribute)

(function () {
  const SPRACHEN = { de: "Deutsch", en: "English" };
  const LOCALES  = { de: "de-DE", en: "en-GB" };
  const STANDARD = "de";
  const KEY      = "sprache";

  function gespeichert() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }

  // Einstellung → Browsersprache → Deutsch
  function ermittleSprache() {
    const wahl = gespeichert();
    if (wahl && SPRACHEN[wahl]) return wahl;
    for (const l of navigator.languages ?? [navigator.language]) {
      const kurz = String(l).slice(0, 2).toLowerCase();
      if (SPRACHEN[kurz]) return kurz;
    }
    return STANDARD;
  }

  function lade(sprache) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `lang/${sprache}.json`, false);   // bewusst synchron (siehe oben)
      xhr.send();
      if (xhr.status === 200) return JSON.parse(xhr.responseText);
      console.error(`Sprachdatei lang/${sprache}.json: HTTP ${xhr.status}`);
    } catch (err) {
      console.error(`Sprachdatei lang/${sprache}.json nicht lesbar:`, err);
    }
    return {};
  }

  const sprache = ermittleSprache();
  const texte   = lade(sprache);
  const rueckfall = sprache === STANDARD ? texte : lade(STANDARD);
  const plural  = new Intl.PluralRules(LOCALES[sprache]);

  const suche = (baum, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), baum);

  function finde(key, params) {
    if (typeof params?.count === "number") {
      const form = `${key}_${plural.select(params.count)}`;
      const text = suche(texte, form) ?? suche(texte, `${key}_other`)
                ?? suche(rueckfall, form) ?? suche(rueckfall, `${key}_other`);
      if (typeof text === "string") return text;
    }
    const text = suche(texte, key) ?? suche(rueckfall, key);
    return typeof text === "string" ? text : key;
  }

  const ersetze = (text, params, wandle) =>
    text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) => (params && name in params ? wandle(params[name]) : m));

  const escape = v => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function t(key, params) {
    return ersetze(finde(key, params), params, v => String(v ?? ""));
  }

  const vorhanden = key => finde(key) !== key;

  function tHtml(key, params) {
    return ersetze(finde(key, params), params, escape);
  }

  // Übersetzt statisches HTML (auch nachträglich eingefügte Bereiche).
  // Fehlt eine Übersetzung, bleibt der deutsche Text aus dem HTML stehen.
  function uebersetze(wurzel = document) {
    wurzel.querySelectorAll("[data-i18n]").forEach(el => {
      if (vorhanden(el.dataset.i18n)) el.textContent = t(el.dataset.i18n);
    });
    wurzel.querySelectorAll("[data-i18n-html]").forEach(el => {
      if (vorhanden(el.dataset.i18nHtml)) el.innerHTML = t(el.dataset.i18nHtml);
    });
    wurzel.querySelectorAll("[data-i18n-attr]").forEach(el => {
      for (const paar of el.dataset.i18nAttr.split(";")) {
        const [attr, key] = paar.split(":").map(s => s.trim());
        if (attr && key && vorhanden(key)) el.setAttribute(attr, t(key));
      }
    });
  }

  // Einstellung ändern: gespeicherte Wahl (null = automatisch), danach neu laden
  function setze(neu) {
    try {
      if (neu && SPRACHEN[neu]) localStorage.setItem(KEY, neu);
      else localStorage.removeItem(KEY);
    } catch { /* nur für diese Sitzung */ }
  }

  document.documentElement.lang = sprache;
  // Bis zur Übersetzung verbergen, damit kein deutscher Text aufblitzt
  if (sprache !== STANDARD) document.documentElement.classList.add("i18n-wartet");
  document.head.insertAdjacentHTML("beforeend", "<style>html.i18n-wartet body { visibility: hidden; }</style>");
  document.addEventListener("DOMContentLoaded", () => {
    uebersetze();
    document.documentElement.classList.remove("i18n-wartet");
  });

  window.t     = t;
  window.tHtml = tHtml;
  window.i18n  = {
    sprache,
    locale: LOCALES[sprache],
    sprachen: SPRACHEN,
    gewaehlt: () => gespeichert(),   // null = automatisch
    setze,
    uebersetze,
  };
})();
