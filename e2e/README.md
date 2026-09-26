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

**Gegen die Docker-Images testen** (so läuft es in der CI): Die Images werden vorher gebaut,
`start.mjs` startet sie dann wie in Produktion (nginx-Frontend + Backend-Container):

```bash
docker build -t drivingbook-e2e-backend  ../backend
docker build -t drivingbook-e2e-frontend ../frontend
E2E_DOCKER=1 DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=fahrtenbuch_test \
DB_USER=fahrtenbuch DB_PASSWORD=test npx playwright test
```

Das Backend läuft dabei im Host-Netz auf Port 3000, das Frontend auf Port 8099; nach dem Lauf
werden die Container entfernt.

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
