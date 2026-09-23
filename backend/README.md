# Fahrtenbuch – Setup & Deployment

## Voraussetzungen
- Docker + Docker Compose
- Node.js 20+ (nur für `setup-helper.js`)

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
| `CORS_ORIGIN` | Erlaubte Frontend-Origin(s), kommagetrennt. Leer = alle (Warnung im Log). |
| `ALLOW_REGISTRATION` | `false` deaktiviert die öffentliche Registrierung. |
| `TRUST_PROXY` | Anzahl Reverse-Proxys (z. B. `1` hinter Traefik) – nötig für korrektes Rate-Limit pro Client-IP. |

---

## 2. Starten

```bash
docker compose up -d --build
```

Beim ersten Start:
- PostgreSQL initialisiert sich automatisch mit `init.sql`
- Das Backend legt den Admin-User + Default-API-Token + Fahrzeug an

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
├── docker-compose.yml
├── .env                  ← nicht in Git!
├── .env.example
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   ├── init.sql
│   └── setup-helper.js
└── frontend/
    ├── Dockerfile
    └── ...
```

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
| POST | `/api/fahrt` | Fahrt speichern |
| GET  | `/api/export/json?month=YYYY-MM` | Fahrten eines Monats |
| GET  | `/api/export/csv/year/:year` | CSV-Export eines Jahres |
| PUT  | `/api/fahrt/:month/:index` | Fahrt bearbeiten |
| DELETE | `/api/fahrt/:month/:index` | Fahrt löschen |
| POST | `/api/fahrt/move` | Fahrt in anderen Monat verschieben |
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
    "vehicle_id": 1
  }'
```

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

-- Passwort zurücksetzen (Hash vorher mit setup-helper.js generieren)
UPDATE users SET password = '<HASH>' WHERE username = 'admin';
```

---

## 8. Backup

```bash
# Datenbank sichern
docker exec fahrtenbuch-db pg_dump -U fahrtenbuch fahrtenbuch > backup_$(date +%Y%m%d).sql

# Wiederherstellen
cat backup_20260429.sql | docker exec -i fahrtenbuch-db psql -U fahrtenbuch -d fahrtenbuch
```
