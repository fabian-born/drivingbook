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
├── stack-compose.yml          ← Homelab (Traefik)
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
│   │   ├── lib/               ← Tokens, Rate-Limit, Geocoding, CSV, PDF, Plausibilität/Audit
│   │   └── routes/            ← auth, account, admin, fahrten, export
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

| Methode | Route | Beschreibung |
|---------|-------|--------------|
| POST | `/api/login` | Login → JWT |
| POST | `/api/register` | Registrierung (abschaltbar) |
| GET  | `/api/health` | Healthcheck |
| POST | `/api/fahrt` | Fahrt speichern |
| PUT  | `/api/fahrt/:id` | Fahrt bearbeiten (Teil-Update; neuer `timestamp` verschiebt ggf. den Monat) |
| DELETE | `/api/fahrt/:id` | Fahrt löschen |
| GET  | `/api/fahrt/:id/history` | Änderungsverlauf einer Fahrt |
| GET  | `/api/audit?year=YYYY` | Änderungen und Löschungen eines Jahres |
| GET  | `/api/vehicles/:id/export` | Sicherung eines Fahrzeugs als JSON (Fahrzeugdaten, Jahreskosten, Fahrten, Änderungsprotokoll) |
| POST | `/api/vehicles/import` | Fahrzeug-Sicherung wiederherstellen – ergänzt nur; Fahrzeug über Code erkannt, sonst neu angelegt (max. 25 MB) |
| GET  | `/api/backup` | Gesamtsicherung aller Fahrzeuge inkl. Fahrten ohne Fahrzeug |
| POST | `/api/backup/restore` | Gesamtsicherung wiederherstellen – ergänzt nur (max. 50 MB) |
| GET  | `/api/backup/status` | Letzte Sicherung je Fahrzeug, Änderungen seitdem, Erinnerung (> 30 Tage) |
| GET  | `/api/admin/aufraeumen` | Admin: doppelte Fahrten und Fahrten ohne Fahrzeug (alle Konten) |
| POST | `/api/admin/aufraeumen/duplikate` | Admin: überzählige Duplikate löschen (`{ ids? }`, protokolliert mit Quelle „admin“) |
| POST | `/api/admin/aufraeumen/ohne-fahrzeug` | Admin: Fahrten ohne Fahrzeug eines Users zuordnen oder löschen (`{ user_id, aktion, vehicle_id? }`) |
| GET  | `/api/vehicles/:id/pruefung?year=YYYY` | Prüfung eines Jahres: Ampel + Auffälligkeiten (km-Rückschritte, Lücken, Koordinaten als Ziel …) |
| GET  | `/api/fahrten?year=YYYY` | Fahrten eines Jahres mit Strecke je Fahrt, Monatsübersicht und Jahressumme |
| GET  | `/api/export/json?month=YYYY-MM` | Fahrten eines Monats (`edited` = nachträglich geändert) |
| GET  | `/api/export/csv/year/:year` | CSV-Export eines Jahres |
| GET  | `/api/export/pdf/year/:year` | PDF-Fahrtenbuch eines Jahres inkl. Änderungsprotokoll |

Audit und alle Exporte akzeptieren optional `?vehicle=CODE` (bzw. `&vehicle=CODE`) und liefern dann
nur Fahrten dieses Fahrzeugs; ohne Angabe werden alle Fahrzeuge berücksichtigt.
| GET  | `/api/vehicles` | Fahrzeuge des Users |
| POST | `/api/vehicles` | Fahrzeug anlegen |
| DELETE | `/api/vehicles/:id` | Fahrzeug löschen |
| GET  | `/api/tokens` | API-Tokens anzeigen |
| POST | `/api/tokens` | API-Token generieren |
| DELETE | `/api/tokens/:id` | API-Token löschen |
| POST | `/api/users` | User anlegen *(nur Admin)* |
| GET  | `/api/users` | Alle User *(nur Admin)* |
| POST | `/api/users/change-password` | Eigenes Passwort ändern |

---

## 6. Fahrt per API-Token eintragen (Beispiel curl)

```bash
curl -X POST https://deine-domain.de/api/fahrt \
  -H "X-API-Token: <DEIN-API-TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "kmstand": 12345,
    "ziel": "Kunde Muster GmbH",
    "fahrtart": "geschäftlich",
    "timestamp": "2026-04-29T09:30:00.000Z",
    "vehicle_code": "A9F82D"
  }'
```

`vehicle_code` ist der 6-stellige Code des Fahrzeugs (sichtbar im Profil unter "Fahrzeuge").
Fehlt `vehicle_code` komplett, wird automatisch das als Standard markierte Fahrzeug verwendet
(falls eins existiert). `"vehicle_code": null` trägt die Fahrt explizit ohne Fahrzeug ein.

**km-Plausibilität:** Ist der km-Stand kleiner als bei der vorherigen oder größer
als bei der folgenden Fahrt desselben Fahrzeugs, antwortet die API mit
`409` und `"code": "KM_PLAUSIBILITY"`. Mit `"force": true` im Body wird trotzdem
gespeichert.

**Änderungsprotokoll:** Jede Anlage, Änderung und Löschung einer Fahrt wird mit
altem und neuem Stand sowie der Quelle (`web` oder `api_token`) in
`fahrten_audit` festgehalten. Gelöschte Fahrten bleiben dort nachvollziehbar.

---

## 7. Datenbank-Zugriff (Wartung)

```bash
docker exec -it fahrtenbuch-db psql -U fahrtenbuch -d fahrtenbuch
```

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
