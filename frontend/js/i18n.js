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
  const LANGUAGES = { de: "Deutsch", en: "English" };
  const LOCALES  = { de: "de-DE", en: "en-GB" };
  const DEFAULT_LANGUAGE = "de";
  const KEY      = "sprache";

  function saved() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }

  // Setting → browser language → German
  function detectLanguage() {
    const storedChoice = saved();
    if (storedChoice && LANGUAGES[storedChoice]) return storedChoice;
    for (const l of navigator.languages ?? [navigator.language]) {
      const langPrefix = String(l).slice(0, 2).toLowerCase();
      if (LANGUAGES[langPrefix]) return langPrefix;
    }
    return DEFAULT_LANGUAGE;
  }

  function loadMessages(currentLanguage) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `lang/${currentLanguage}.json`, false);   // synchronous on purpose (see above)
      xhr.send();
      if (xhr.status === 200) return JSON.parse(xhr.responseText);
      console.error(`Sprachdatei lang/${currentLanguage}.json: HTTP ${xhr.status}`);
    } catch (err) {
      console.error(`Sprachdatei lang/${currentLanguage}.json nicht lesbar:`, err);
    }
    return {};
  }

  const currentLanguage = detectLanguage();
  const messages   = loadMessages(currentLanguage);
  const fallbackMessages = currentLanguage === DEFAULT_LANGUAGE ? messages : loadMessages(DEFAULT_LANGUAGE);
  const plural  = new Intl.PluralRules(LOCALES[currentLanguage]);

  const lookup = (tree, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), tree);

  function finde(key, params) {
    if (typeof params?.count === "number") {
      const form = `${key}_${plural.select(params.count)}`;
      const text = lookup(messages, form) ?? lookup(messages, `${key}_other`)
                ?? lookup(fallbackMessages, form) ?? lookup(fallbackMessages, `${key}_other`);
      if (typeof text === "string") return text;
    }
    const text = lookup(messages, key) ?? lookup(fallbackMessages, key);
    return typeof text === "string" ? text : key;
  }

  const interpolate = (text, params, transform) =>
    text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) => (params && name in params ? transform(params[name]) : m));

  const escape = v => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function t(key, params) {
    return interpolate(finde(key, params), params, v => String(v ?? ""));
  }

  const hasKey = key => finde(key) !== key;

  function tHtml(key, params) {
    return interpolate(finde(key, params), params, escape);
  }

  // Translates static HTML (including sections inserted later).
  // If a translation is missing, the German text from the HTML stays.
  function translatePage(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(el => {
      if (hasKey(el.dataset.i18n)) el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-html]").forEach(el => {
      if (hasKey(el.dataset.i18nHtml)) el.innerHTML = t(el.dataset.i18nHtml);
    });
    root.querySelectorAll("[data-i18n-attr]").forEach(el => {
      for (const pair of el.dataset.i18nAttr.split(";")) {
        const [attr, key] = pair.split(":").map(s => s.trim());
        if (attr && key && hasKey(key)) el.setAttribute(attr, t(key));
      }
    });
  }

  // Change the setting: stored choice (null = automatic), then reload
  function setLanguage(newValue) {
    try {
      if (newValue && LANGUAGES[newValue]) localStorage.setItem(KEY, newValue);
      else localStorage.removeItem(KEY);
    } catch { /* for this session only */ }
  }

  document.documentElement.lang = currentLanguage;
  // Hide until translated so no German text flashes up
  if (currentLanguage !== DEFAULT_LANGUAGE) document.documentElement.classList.add("i18n-pending");
  document.head.insertAdjacentHTML("beforeend", "<style>html.i18n-pending body { visibility: hidden; }</style>");
  document.addEventListener("DOMContentLoaded", () => {
    translatePage();
    document.documentElement.classList.remove("i18n-pending");
  });

  window.t     = t;
  window.tHtml = tHtml;
  window.i18n  = {
    language: currentLanguage,
    locale: LOCALES[currentLanguage],
    languages: LANGUAGES,
    selected: () => saved(),   // null = automatic
    set: setLanguage,
    translate: translatePage,
  };
})();
