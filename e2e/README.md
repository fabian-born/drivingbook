# Browser-Tests (Playwright)

Testen Frontend und Backend zusammen im echten Browser: Login, Fahrzeug-Kontext,
Offline-Warteschlange, Auto-Info/Steuervergleich, Prüfung, Export/Import und PWA-Dateien.

`start.mjs` leert die Test-Datenbank (**Schema `public` wird gelöscht!** – der Name muss
deshalb „test“ enthalten, sonst bricht der Start ab), startet das
Backend auf Port 3999 und das Frontend inkl. `/api`-Proxy auf Port 8099.

```bash
cd e2e
npm ci
npx playwright install chromium          # einmalig
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=fahrtenbuch_test \
DB_USER=fahrtenbuch DB_PASSWORD=test npx playwright test
```

Testbenutzer werden über die Admin-API angelegt (die Registrierung ist ratenbegrenzt).
In der CI laufen die Tests bei jeder Änderung an `frontend/`, `backend/` oder `e2e/`;
Images werden nur gebaut, wenn sie bestehen.

## Screenshots für die Projektseite

`screenshots/` ist kein Test, sondern erzeugt mit Demo-Daten (Vorjahr + laufendes Jahr)
die Bilder für die GitHub-Page in `docs/img/` (englische Oberfläche). Gleiche Umgebung wie oben:

```bash
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=fahrtenbuch_test \
DB_USER=fahrtenbuch DB_PASSWORD=test npx playwright test -c screenshots.config.js
```
