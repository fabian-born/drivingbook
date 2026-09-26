# Mehrsprachigkeit (Deutsch + Englisch, erweiterbar)

Ziel: Frontend, Backend-Meldungen, PDF und CSV in mehreren Sprachen. Start mit `de` und `en`;
jede weitere Sprache braucht nur eigene Sprachdateien.

## Entscheidungen

- **Format:** JSON im i18next-Format, verschachtelte Schlüssel (`"nav": { "dashboard": "…" }`),
  Platzhalter `{{name}}`, Einzahl/Mehrzahl als `key_one` / `key_other` (über `Intl.PluralRules`).
  Kein Framework; ein späterer Wechsel auf i18next geht ohne Änderung der Dateien.
- **Frontend:**
  - `frontend/lang/<sprache>.json`, geladen von `js/i18n.js` im `<head>` jeder Seite.
    Die Datei wird synchron geladen, damit alle bestehenden Skripte `t()` sofort nutzen können
    (offline aus dem Service-Worker-Cache).
  - API:
    - `t(key, params)` liefert Text für `textContent`, `alert` und `confirm`.
    - `tHtml(key, params)` escaped die Parameter, für `innerHTML` mit Nutzerdaten.
    - `i18n.locale` gilt für Datum und Zahlen, statt fest `"de-DE"`.
  - HTML: `data-i18n="key"` setzt `textContent`, `data-i18n-html="key"` setzt eigenes Markup
    (z. B. Links), `data-i18n-attr="placeholder:key;title:key"` setzt Attribute.
    Der deutsche Text bleibt als Rückfall im HTML stehen.
  - Rückfall beim Suchen: aktive Sprache → Deutsch → Schlüssel.
- **Sprachwahl:**
  - Spalte `users.language` (NULL = automatisch), gesetzt über `PATCH /api/profile`.
    Das Login liefert sie mit, das Frontend merkt sie sich in `localStorage.sprache`.
  - Reihenfolge: Einstellung → Browsersprache (`navigator.languages`) → `de`.
  - Auswahl im Profil (Konto) und auf der Login-Seite.
- **Backend:**
  - `src/lang/<sprache>.json`, `src/i18n.js`.
  - Die Sprache kommt aus `Accept-Language`; `apiFetch` schickt sie immer mit.
    Ohne Header (API-Token, Home Assistant, Tests) antwortet das Backend auf Deutsch.
  - Fehlermeldungen:
    - `HttpError(status, "schluessel", extra, params)`.
    - Zod-Meldungen sind Schlüssel.
    - Der `errorHandler` übersetzt; unbekannte Schlüssel werden unverändert ausgegeben.
  - Prüfbefunde (`check.js`), Erfolgsmeldungen, PDF- und CSV-Beschriftungen sowie Datums- und
    Zahlenformate im PDF richten sich nach der Sprache.
- **Locale:** `de` → `de-DE`, `en` → `en-GB` (Tag/Monat, 24 h, Europa).
- **Fachlich:** Der Steuervergleich bleibt deutsches Recht. Sprache und Land sind getrennt.

## Schritte (je ein Commit)

- [x] 1. Plan (dieses Dokument)
- [x] 2. Grundgerüst Frontend:
      - `i18n.js`, Sprachdateien, Einbindung in alle Seiten, Service Worker, `Accept-Language`.
      - `users.language` (Migration 013), `PATCH /api/profile`, Login-Antwort, Auswahl im Profil und beim Login.
      - Gemeinsame Teile übersetzt: Navigation, `config.js`, `offline.js`, `backup.js`, Footer, Login, Registrierung.
- [x] 3a. Seiten: Neue Fahrt, Dashboard (+ `analysis.js`), Jahreshistorie, Fahrten anzeigen
- [x] 3b. Seiten: Auto-Info, Konto, Admin
- [x] 4. Backend: Fehlermeldungen, Erfolgsmeldungen, Prüfbefunde
- [x] 5. PDF und CSV
- [x] 6. Tests für Englisch (Backend + Browser), Doku (README, GitHub-Page), Aufräumen

Nach jedem Schritt: Backend-Tests und Browser-Tests grün (Standard bleibt Deutsch).
