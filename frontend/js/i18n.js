// js/i18n.js
// Internationalization. Loaded in the <head> of every page right after theme.js.
// Language files: lang/<language>.json in i18next format (nested keys,
// placeholders {{name}}, plurals as key_one / key_other).
// The active language is loaded synchronously so all other scripts can use t()
// right away; offline it comes from the service worker cache.
//
//   t("nav.dashboard")                     → text (for textContent, alert, confirm)
//   t("dashboard.trips", { count: 3 })     → plural via Intl.PluralRules
//   tHtml("key", { name })                 → parameters HTML-escaped (for innerHTML)
//   i18n.locale                            → e.g. "de-DE" for dates and numbers
//
// HTML: data-i18n="key" (textContent), data-i18n-html="key" (own markup),
//       data-i18n-attr="placeholder:key;title:key2" (attributes)

(function () {
  const SPRACHEN = { de: "Deutsch", en: "English" };
  const LOCALES  = { de: "de-DE", en: "en-GB" };
  const STANDARD = "de";
  const KEY      = "sprache";

  function gespeichert() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }

  // Setting → browser language → German
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
      xhr.open("GET", `lang/${sprache}.json`, false);   // synchronous on purpose (see above)
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

  // Translates static HTML (including sections inserted later).
  // If a translation is missing, the German text from the HTML stays.
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

  // Change the setting: stored choice (null = automatic), then reload
  function setze(neu) {
    try {
      if (neu && SPRACHEN[neu]) localStorage.setItem(KEY, neu);
      else localStorage.removeItem(KEY);
    } catch { /* for this session only */ }
  }

  document.documentElement.lang = sprache;
  // Hide until translated so no German text flashes up
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
    gewaehlt: () => gespeichert(),   // null = automatic
    setze,
    uebersetze,
  };
})();
