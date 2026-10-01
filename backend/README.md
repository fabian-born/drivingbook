# Fahrtenbuch – Setup & Deployment

## Voraussetzungen
- Docker + Docker Compose
- Node.js 20+ (nur für lokale Entwicklung und Tests)

---

## 1. Erstkonfiguration

### 1a. Umgebungsvariablen anlegen
```bash
cp .env.example .env
```
Dann `.env` öffnen und **alle CHANGE_ME-Werte** ersetzen. Pflicht ist mindestens
`JWT_SECRET` (≥ 32 zufällige Zeichen) – ohne startet das Backend nicht:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Weitere sicherheitsrelevante Variablen:

| Variable | Bedeutung |
|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin für den ersten Start auf leerer DB. Ohne Passwort wird eines generiert und einmalig geloggt. |
| `CORS_ORIGIN` | Nur nötig, wenn das Frontend die API von einer anderen Origin aufruft (kommagetrennt). Leer = nur gleiche Origin; das Frontend-nginx leitet `/api` ans Backend weiter. |
| `ALLOW_REGISTRATION` | `false` deaktiviert die öffentliche Registrierung. |
| `TRUST_PROXY` | Anzahl Reverse-Proxys vor dem Backend (`1` = Frontend-nginx, `2` = Traefik + nginx) – nötig für korrektes Rate-Limit pro Client-IP. |
| `NOMINATIM_EMAIL` | Kontaktadresse für das Reverse-Geocoding über OpenStreetMap (empfohlen). `GEOCODING=false` schaltet es ab. |
| `BACKUP_KEEP_DAYS` | Aufbewahrungsdauer der täglichen Backups (Standard 14). |

---

## 2. Starten

```bash
docker compose up -d --build
```

Beim Start:
- Das Backend spielt alle noch fehlenden Migrationen aus `backend/migrations/` ein
  (Tabelle `schema_migrations` merkt sich den Stand). Das funktioniert auch mit
  Datenbanken, die noch mit der alten `init.sql` angelegt wurden.
- Auf einer leeren Datenbank legt es den Admin-User + Default-API-Token + Fahrzeug an.
- Das Frontend ist erst erreichbar, wenn `/api/health` des Backends antwortet.

Sicherheitsverhalten beim Start:
- API-Tokens werden nur als SHA-256-Hash gespeichert. Bestehende Datenbanken
  werden automatisch migriert; vorhandene Tokens funktionieren weiter, können
  aber nicht mehr angezeigt werden.
- Der früher per `init.sql` angelegte, vorhersagbare Token
  `fahrtenbuch-default-token-CHANGE-ME-*` wird widerrufen.
- Hat der User `admin` noch das Passwort `admin`, erscheint eine Warnung.
- Login: max. 10 Fehlversuche pro 15 Minuten (je IP + Benutzername),
  Registrierung: max. 5 pro Stunde je IP.

Logs prüfen:
```bash
docker compose logs -f backend
```

---

## 3. Projektstruktur

```
.
├── docker-compose.yaml        ← lokal
├── stack-compose.example.yml  ← Vorlage Homelab (Traefik)
├── stack-compose.yml          ← eigene Kopie der Vorlage, nicht in Git!
├── .env                       ← nicht in Git!
├── .env.example
├── backend/
│   ├── server.js              ← Start: Konfiguration, Migrationen, Server
│   ├── migrate.js             ← einmaliger Import alter JSON-Dateien
│   ├── migrations/            ← SQL-Migrationen (001_…, 002_…, …)
│   ├── src/
│   │   ├── app.js             ← Express-App
│   │   ├── config.js, db.js, http.js, schemas.js, bootstrap.js
│   │   ├── middleware/auth.js
│   │   ├── lib/               ← trips (Plausibilität/Audit), distances, check, tax, backup,
│   │   │                        cleanup, pdf, csv, tokens, rateLimit, geocode, vehicles
│   │   └── routes/            ← auth, account, admin, trips, vehicles, export, backup
│   ├── scripts/               ← reset-password.js, convert-backup.js
│   └── test/                  ← API-Tests (node:test + supertest)
└── frontend/
    ├── *.html, js/, icons/
    ├── manifest.webmanifest, sw.js   ← PWA / Offline
    └── _config/nginx.conf     ← leitet /api ans Backend weiter
```

Neue Schemaänderungen als nächste nummerierte Datei in `backend/migrations/`
ablegen (z. B. `004_….sql`). Bereits angewendete Dateien nicht mehr ändern.

---

## 4. Auth-Methoden

### Login (JWT)
```http
POST /api/login
Content-Type: application/json

{ "username": "admin", "password": "deinPasswort" }
```
Antwort: `{ "token": "<JWT>", "user": { ... } }`

JWT in allen weiteren Requests:
```http
Authorization: Bearer <JWT>
```

### API-Token (für Skripte / Home Assistant / etc.)
```http
Authorization: Bearer <API-TOKEN>
# oder alternativ:
X-API-Token: <API-TOKEN>
```

Token-Verwaltung:
```http
GET    /api/tokens          # Alle Tokens des Users
POST   /api/tokens          # Neuen Token generieren
DELETE /api/tokens/:id      # Token löschen
```

---

## 5. Wichtige Endpoints

Pfade, Feldnamen und Werte der API sind englisch (seit 09/2026); Fehlermeldungen sind deutsch.

| Methode | Route | Beschreibung |
|---------|-------|--------------|
| POST | `/api/login` | Login → JWT |
| POST | `/api/register` | Registrierung (abschaltbar) |
| GET  | `/api/health` | Healthcheck (inkl. Backend-Version) |
| POST | `/api/trips` | Fahrt speichern |
| PUT  | `/api/trips/:id` | Fahrt bearbeiten (Teil-Update; neuer `timestamp` verschiebt ggf. den Monat) |
| DELETE | `/api/trips/:id` | Fahrt löschen |
| GET  | `/api/trips/:id/history` | Änderungsverlauf einer Fahrt |
| GET  | `/api/trips?year=YYYY` | Fahrten eines Jahres mit Strecke (`distance`), Monatsübersicht (`months`) und Jahressumme (`totals`) |
| GET  | `/api/audit?year=YYYY` | Änderungen und Löschungen eines Jahres |
| GET  | `/api/export/json?month=YYYY-MM` | Fahrten eines Monats (`edited` = nachträglich geändert) |
| GET  | `/api/export/csv/year/:year` | CSV-Export eines Jahres (Spalten deutsch) |
| GET  | `/api/export/pdf/year/:year` | PDF-Fahrtenbuch eines Jahres inkl. Änderungsprotokoll |
| GET  | `/api/vehicles` | Fahrzeuge des Users |
| POST | `/api/vehicles` | Fahrzeug anlegen |
| PATCH | `/api/vehicles/:id` | Name, Kennzeichen, Listenpreis, Antrieb (`drive_type`) ändern |
| DELETE | `/api/vehicles/:id[?target=ID]` | Fahrzeug löschen; hat es Fahrten, ziehen sie in Fahrzeug `target` um (protokolliert), ohne `target` → 409 `HAS_TRIPS` |
| GET  | `/api/vehicles/:id/info?year=YYYY` | Auto-Info: Kennzahlen, Jahreskosten, Vergleich 1-%-Regel ↔ Fahrtenbuch (`comparison`) |
| PATCH | `/api/profile` | Eigene Einstellungen (`language`: `de`/`en`/`null`) |
| PATCH | `/api/vehicles/:id/default` | Fahrzeug als Standard markieren |
| PUT  | `/api/vehicles/:id/years/:year` | Jahreskosten speichern |
| GET  | `/api/vehicles/:id/check?year=YYYY` | Prüfung eines Jahres: `status` (green/yellow/red) + `findings` |
| GET  | `/api/vehicles/:id/export` | Sicherung eines Fahrzeugs (Format v2) |
| POST | `/api/vehicles/import` | Fahrzeug-Sicherung wiederherstellen – ergänzt nur; Format v2 (max. 25 MB) |
| GET  | `/api/backup` | Gesamtsicherung aller Fahrzeuge inkl. Fahrten ohne Fahrzeug |
| POST | `/api/backup/restore` | Gesamtsicherung wiederherstellen – ergänzt nur; Format v2 (max. 50 MB) |
| GET  | `/api/backup/status` | Letzte Sicherung je Fahrzeug, Änderungen seitdem, Erinnerung (> 30 Tage) |
| GET  | `/api/admin/cleanup` | Admin: doppelte Fahrten und Fahrten ohne Fahrzeug (alle Konten) |
| POST | `/api/admin/cleanup/duplicates` | Admin: überzählige Duplikate löschen (`{ ids? }`, protokolliert mit Quelle „admin“) |
| POST | `/api/admin/cleanup/unassigned` | Admin: Fahrten ohne Fahrzeug zuordnen oder löschen (`{ user_id, action: "assign" \| "delete", vehicle_id? }`) |
| GET  | `/api/tokens` | API-Tokens anzeigen |
| POST | `/api/tokens` | API-Token generieren |
| DELETE | `/api/tokens/:id` | API-Token löschen |
| POST | `/api/users` | User anlegen *(nur Admin)* |
| GET  | `/api/users` | Alle User *(nur Admin)* |
| PATCH | `/api/admin/users/:id` | Rolle (`user`/`admin`) und/oder Land eines Users ändern *(nur Admin; nicht die eigene Rolle)* |
| GET  | `/api/admin/countries` | Länder, die der Steuervergleich unterstützt *(nur Admin)* |
| POST | `/api/users/change-password` | Eigenes Passwort ändern |

Audit und alle Exporte akzeptieren optional `?vehicle=CODE` (bzw. `&vehicle=CODE`) und liefern dann
nur Fahrten dieses Fahrzeugs; ohne Angabe werden alle Fahrzeuge berücksichtigt.

---

## 6. Fahrt per API-Token eintragen (Beispiel curl)

```bash
curl -X POST https://deine-domain.de/api/trips \
  -H "X-API-Token: <DEIN-API-TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "odometer_km": 12345,
    "destination": "Kunde Muster GmbH",
    "trip_type": "business",
    "timestamp": "2026-04-29T09:30:00.000Z",
    "vehicle_code": "A9F82D"
  }'
```

`trip_type`: `business` (geschäftlich), `private` (privat) oder `commute` (Arbeitsweg).
`vehicle_code` ist der 6-stellige Code des Fahrzeugs (Profil → Auto-Info).
Fehlt `vehicle_code` komplett, wird automatisch das als Standard markierte Fahrzeug verwendet
(falls eins existiert). `"vehicle_code": null` trägt die Fahrt explizit ohne Fahrzeug ein.

**km-Plausibilität:** Ist der km-Stand kleiner als bei der vorherigen oder größer
als bei der folgenden Fahrt desselben Fahrzeugs, antwortet die API mit
`409` und `"code": "KM_PLAUSIBILITY"`. Mit `"force": true` im Body wird trotzdem
gespeichert.

**Änderungsprotokoll:** Jede Anlage, Änderung und Löschung einer Fahrt wird mit
altem und neuem Stand sowie der Quelle (`web`, `api_token` oder `admin`) in
`trip_audit` festgehalten. Gelöschte Fahrten bleiben dort nachvollziehbar.

---

## 7. Datenbank-Zugriff (Wartung)

```bash
docker exec -it fahrtenbuch-db psql -U fahrtenbuch -d fahrtenbuch   # Prod: drivingbook-db
```

Datenbank und API verwenden dieselben englischen Namen: Tabellen `trips` (`odometer_km`,
`destination`, `trip_type`) und `trip_audit` (`trip_id`), Werte `business`/`private`/`commute`
und `combustion`/`hybrid`/`electric`/`electric_high_price`. Sicherungsdateien im alten
Format v1 (deutsche Felder, bis 09/2026) nimmt das Backend nicht mehr an; sie werden vorher
umgewandelt:

```bash
node scripts/convert-backup.js alt.json [neu.json]    # ohne Ziel: alt-v2.json
```

Das Skript braucht keine Abhängigkeiten und läuft auch außerhalb des Containers (Node ≥ 20).

Nützliche Queries:
```sql
-- Alle User anzeigen
SELECT id, username, role, created_at FROM users;

-- API-Tokens eines Users
SELECT id, label, is_default, created_at FROM api_tokens WHERE user_id = 1;

-- Passwort zurücksetzen: Hash erzeugen mit
--   docker exec fahrtenbuch-backend node -e "import('bcrypt').then(b=>b.default.hash(process.argv[1],12).then(console.log))" 'NeuesPasswort'
UPDATE users SET password = '<HASH>' WHERE username = 'admin';
```

---

## 8. Backup

Der Container `fahrtenbuch-backup` sichert die Datenbank täglich als
`fahrtenbuch_<datum>.sql.gz` (lokal nach `backend/data/backups/`, im Homelab nach
`…/fahrtenbuch/backups/`) und löscht Dateien, die älter als `BACKUP_KEEP_DAYS` sind.
Die Backups liegen auf demselben Host – für echte Sicherheit zusätzlich extern kopieren.

```bash
# Sofort ein zusätzliches Backup erstellen
docker exec fahrtenbuch-db pg_dump -U fahrtenbuch --no-owner fahrtenbuch | gzip > backup_$(date +%Y%m%d).sql.gz

# Wiederherstellen (in eine leere Datenbank)
docker compose stop backend
docker exec fahrtenbuch-db psql -U fahrtenbuch -d postgres -c "DROP DATABASE fahrtenbuch" -c "CREATE DATABASE fahrtenbuch"
gunzip -c backup_20260429.sql.gz | docker exec -i fahrtenbuch-db psql -U fahrtenbuch -d fahrtenbuch
docker compose start backend
```

---

## 9. Tests

Die API-Tests brauchen eine PostgreSQL-Instanz. **Achtung:** Das Schema `public`
der angegebenen Datenbank wird dabei komplett geleert – nie gegen die echte DB laufen lassen.

```bash
docker run -d --rm --name fb-test-db -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:16-alpine
cd backend && npm ci
DB_HOST=127.0.0.1 DB_PORT=55432 DB_USER=postgres DB_NAME=postgres DB_PASSWORD=test npm test
```

In der CI laufen die Tests automatisch vor jedem Backend-Build.

---

## 10. App auf dem Handy (PWA)

Das Frontend lässt sich im Browser über „Zum Startbildschirm hinzufügen“
installieren. Seiten und Skripte werden gecacht; auf der Seite „Neue Fahrt“ können
Fahrten auch **ohne Verbindung** erfasst werden. Sie werden lokal gespeichert und
automatisch übertragen, sobald wieder eine Verbindung besteht (oder per
„Jetzt senden“). Der Standort-Button trägt offline die GPS-Koordinaten ein; das
Backend wandelt sie beim Übertragen in eine Adresse um.

PWA-Funktionen erfordern HTTPS (oder `localhost`).

## 11. Sprachen

Oberfläche, Fehlermeldungen, Prüfbefunde, PDF und CSV gibt es auf **Deutsch** und **Englisch**.

- **Welche Sprache gilt:** die Wahl im Profil (Konto → Sprache; gilt für alle Geräte). Ohne Wahl gilt
  die Browsersprache, sonst Deutsch. Vor dem Login lässt sie sich auf der Login-Seite umstellen.
- **Backend:** Es antwortet in der Sprache aus `Accept-Language`, die das Frontend immer mitschickt.
  Ohne Header, z. B. bei API-Token-Clients wie Home Assistant, antwortet es auf Deutsch.
- **Dateien:** `frontend/lang/<sprache>.json` und `backend/src/lang/<sprache>.json`, im i18next-Format
  (verschachtelte Schlüssel, `{{platzhalter}}`, Mehrzahl als `schluessel_one` / `schluessel_other`).
- **Fachlich:** Der Steuervergleich bleibt deutsches Recht, unabhängig von der Sprache (Land steht getrennt im Profil).

**Neue Sprache hinzufügen** (Beispiel Französisch `fr`):
1. `frontend/lang/de.json` nach `frontend/lang/fr.json` kopieren und übersetzen, ebenso
   `backend/src/lang/de.json` → `backend/src/lang/fr.json`.
2. In `frontend/js/i18n.js` bei `SPRACHEN` (`fr: "Français"`) und `LOCALES` (`fr: "fr-FR"`) ergänzen.
3. In `backend/src/schemas.js` bei `LANGUAGES` und in `backend/src/i18n.js` bei `LOCALES` ergänzen.
4. `lang/fr.json` in `APP_SHELL` von `frontend/sw.js` eintragen (Offline-Cache).
5. Optional: CSV-Trennzeichen und Datumsformat in `CSV_FORMAT` (`backend/src/routes/export.js`).

Fehlende Schlüssel fallen automatisch auf Deutsch zurück.

## Versionierung

Frontend und Backend haben getrennte Versionen im Schema `JJJJ.MM.TT.N`
(`frontend/release.ver`, `backend/release.ver`). Ein Git-Hook zählt sie beim
Commit automatisch hoch, sobald sich im jeweiligen Ordner etwas ändert.
Einmalig pro Klon aktivieren:

```bash
git config core.hooksPath .githooks
```

Die Backend-Version liefert `GET /api/health`; der Footer zeigt beide Versionen.

## Prod prüfen

`./scripts/check-prod.sh` prüft per SSH (nur lesend) Versionen gegen das Repo, angewendete
Migrationen, einige Datenpunkte und Fehler im Backend-Log. Auf Prod heißen die Container
`drivingbook-backend`, `drivebook-frontend` und `drivingbook-db`.

## Passwort vergessen

Setzt das Passwort eines Benutzers direkt in der Datenbank zurück (Standard: `admin`).
Im Terminal wird das neue Passwort verdeckt abgefragt; leer lassen erzeugt ein zufälliges.

```bash
# Prod (Stack auf docker-host-01)
docker exec -it drivingbook-backend node scripts/reset-password.js admin
# lokal mit docker-compose.yaml
docker exec -it fahrtenbuch-backend node scripts/reset-password.js admin
```

Nach zu vielen Fehlversuchen ist der Login für diese IP + Benutzername 15 Minuten gesperrt
(oder bis das Backend neu gestartet wird).
