# Frontend-Code auf Englisch

Ziel: Kommentare, Bezeichner und Dateinamen im Frontend englisch, wie im Backend.
Sichtbare Texte kommen aus `lang/*.json` und sind davon nicht betroffen.

## Bewusst unverändert

- **Schlüssel im `localStorage`:** `authToken`, `aktivesFahrzeug`, `fahrzeuge`, `offlineFahrten`,
  `sprache`, `darstellung`, `backupReminder…`. Eine Umbenennung würde gespeicherte Einstellungen
  und noch nicht gesendete Offline-Fahrten auf den Geräten verwerfen.
- **Werte, die das Backend erwartet**, und die Sprachschlüssel in `lang/*.json`.

## Schritte (je ein Commit, danach Browser-Tests grün)

- [x] a. Kommentare (JS, HTML, CSS, sw.js). Prüfung per Token-Vergleich: nur Kommentare geändert.
- [x] b. Funktionen und Variablen (AST-basiert über alle Skripte gemeinsam, da globaler Namensraum;
      dazu Inline-Skripte und `onclick` in HTML).
- [ ] c. DOM-IDs, CSS-Klassen, eigene Events, Dateinamen (`js/*.js`) inkl. Browser-Tests,
      `APP_SHELL` in `sw.js` und `<script src>`.
