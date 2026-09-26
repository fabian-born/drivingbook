// ============================================================
// Translations for API messages, check findings, PDF and CSV.
// Files: src/lang/<language>.json in i18next format (nested keys,
// {{placeholders}}, plural forms key_one / key_other).
// The language comes from the Accept-Language header; requests
// without it (API tokens, Home Assistant, tests) get German.
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LANGUAGES } from "./schemas.js";

export const DEFAULT_LANGUAGE = "de";
const LOCALES = { de: "de-DE", en: "en-GB" };

const dir   = path.join(path.dirname(fileURLToPath(import.meta.url)), "lang");
const texts = Object.fromEntries(LANGUAGES.map(l =>
  [l, JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), "utf8"))]));

export const localeOf = language => LOCALES[language] ?? LOCALES[DEFAULT_LANGUAGE];

// First supported language from Accept-Language (by q value), else German
export function languageFrom(req) {
  const header = req.get?.("accept-language");
  if (!header) return DEFAULT_LANGUAGE;
  const wanted = header.split(",")
    .map((part, i) => {
      const [tag, ...opts] = part.trim().split(";");
      const q = Number(opts.find(o => o.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: tag.slice(0, 2).toLowerCase(), q: isNaN(q) ? 0 : q, i };
    })
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return wanted.find(w => LANGUAGES.includes(w.lang))?.lang ?? DEFAULT_LANGUAGE;
}

const lookup = (tree, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), tree);

function find(language, key, params) {
  const trees = [texts[language], texts[DEFAULT_LANGUAGE]].filter(Boolean);
  if (typeof params?.count === "number") {
    const form = new Intl.PluralRules(localeOf(language)).select(params.count);
    for (const tree of trees) {
      const text = lookup(tree, `${key}_${form}`) ?? lookup(tree, `${key}_other`);
      if (typeof text === "string") return text;
    }
  }
  for (const tree of trees) {
    const text = lookup(tree, key);
    if (typeof text === "string") return text;
  }
  return null;
}

// Translates `key`; unknown keys (e.g. literal messages) are returned unchanged.
// A parameter may be a function of the locale, e.g. for dates.
export function translate(language, key, params = {}) {
  const text = find(language, key, params);
  if (text == null) return key;
  const locale = localeOf(language);
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) => {
    if (!(name in params)) return m;
    const v = params[name];
    return String(typeof v === "function" ? v(locale) : v ?? "");
  });
}

// Express middleware: req.language and req.t(key, params)
export function i18nMiddleware(req, res, next) {
  req.language = languageFrom(req);
  req.t = (key, params) => translate(req.language, key, params);
  next();
}
