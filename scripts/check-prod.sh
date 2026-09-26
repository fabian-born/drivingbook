#!/usr/bin/env bash
# ============================================================
# Fahrtenbuch – Prod-Deployment prüfen (nur lesend)
#
#   ./scripts/check-prod.sh
#
# Prüft per SSH: laufende Container, Versionen im Vergleich zum Repo,
# angewendete Migrationen und einige Datenprüfungen (schreibgeschützte
# Transaktion). Ändert nichts.
#
# Umgebungsvariablen:
#   PROD_HOST           SSH-Ziel               (Standard: docker-host-01)
#   BACKEND_CONTAINER   (Standard: drivingbook-backend)
#   FRONTEND_CONTAINER  (Standard: drivebook-frontend)
#   DB_CONTAINER        (Standard: drivingbook-db)
# ============================================================
set -euo pipefail

PROD_HOST="${PROD_HOST:-docker-host-01}"
BACKEND="${BACKEND_CONTAINER:-drivingbook-backend}"
FRONTEND="${FRONTEND_CONTAINER:-drivebook-frontend}"
DB="${DB_CONTAINER:-drivingbook-db}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

prod() { ssh -o BatchMode=yes "$PROD_HOST" "$@"; }

echo "→ Container auf $PROD_HOST"
prod "docker ps --format '  {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -E '$BACKEND|$FRONTEND|$DB' || true"

vergleiche() {
  local name="$1" live="$2" repo="$3"
  if [[ "$live" == "$repo" ]]; then
    echo "  ✅ $name $live (aktuell)"
  else
    echo "  ⚠️  $name läuft mit $live, im Repo ist $repo – neues Image deployen"
  fi
}

echo "→ Versionen"
backend_live="$(prod "docker exec $BACKEND node -e 'fetch(\"http://localhost:3000/api/health\").then(r=>r.json()).then(j=>console.log(j.version))'")"
frontend_live="$(prod "docker exec $FRONTEND cat /usr/share/nginx/html/release.ver")"
vergleiche "Backend " "$backend_live"  "$(cat "$REPO/backend/release.ver")"
vergleiche "Frontend" "$frontend_live" "$(cat "$REPO/frontend/release.ver")"

echo "→ Migrationen"
erwartet="$(ls "$REPO/backend/migrations" | grep '\.sql$' | sort)"
angewendet="$(echo "SELECT name FROM schema_migrations ORDER BY name;" |
  prod "docker exec -i $DB sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At'")"
fehlend="$(comm -23 <(echo "$erwartet") <(echo "$angewendet"))"
if [[ -z "$fehlend" ]]; then
  echo "  ✅ alle $(echo "$erwartet" | wc -l | tr -d ' ') Migrationen angewendet"
else
  echo "  ⚠️  noch nicht angewendet (Backend neu starten/deployen):"; echo "$fehlend" | sed 's/^/     /'
fi

echo "→ Daten"
prod "docker exec -i $DB sh -c 'psql -q -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -v ON_ERROR_STOP=1'" <<'SQL' | sed 's/^/  /'
BEGIN TRANSACTION READ ONLY;
SELECT 'Benutzernamen mit Großbuchstaben: ' || COUNT(*) FROM users WHERE username <> LOWER(username);
SELECT 'Index auf LOWER(username):        ' || EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_username_lower_key');
SELECT 'Fahrten ohne Fahrzeug:            ' || COUNT(*) FROM fahrten WHERE vehicle_id IS NULL;
SELECT 'Fahrzeuge (letzte Sicherung):     ' || COALESCE(string_agg(name || ' = ' || COALESCE(to_char(last_backup_at, 'DD.MM.YYYY'), 'nie'), ', ' ORDER BY id), '–') FROM vehicles;
ROLLBACK;
SQL

echo "→ Fehler im Backend-Log (letzte 24 h)"
fehler="$(prod "docker logs --since 24h $BACKEND 2>&1 | grep -E '❌|Fehler bei|fehlgeschlagen' | tail -5" || true)"
if [[ -z "$fehler" ]]; then echo "  ✅ keine"; else echo "$fehler" | sed 's/^/  /'; fi
