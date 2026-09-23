#!/usr/bin/env bash
# ============================================================
# Fahrtenbuch – Prod-Datenbank in die lokale Dev-DB einspielen
#
#   ./scripts/pull-prod-db.sh                 frischer Dump per SSH
#   ./scripts/pull-prod-db.sh backup.sql.gz   vorhandenes Tages-Backup
#
# Umgebungsvariablen:
#   PROD_HOST   SSH-Ziel des Prod-Hosts (Standard: docker-host-01)
#   DB_NAME     Datenbankname           (Standard: fahrtenbuch)
#   DB_USER     Datenbank-User          (Standard: fahrtenbuch)
#
# ACHTUNG: Die lokale Dev-Datenbank wird komplett ersetzt!
# ============================================================
set -euo pipefail

PROD_HOST="${PROD_HOST:-docker-host-01}"
DB_NAME="${DB_NAME:-fahrtenbuch}"
DB_USER="${DB_USER:-fahrtenbuch}"
CONTAINER="fahrtenbuch-db"
BACKUP_FILE="${1:-}"

cd "$(dirname "$0")/.."

# Dump landet in einem temporären Verzeichnis und wird am Ende gelöscht
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [[ -z "$BACKUP_FILE" ]]; then
  echo "→ Ziehe Dump von $PROD_HOST …"
  ssh "$PROD_HOST" \
    "docker exec $CONTAINER pg_dump -U $DB_USER -d $DB_NAME -Fc --no-owner --no-privileges" \
    > "$tmp/prod.dump"
  echo "  $(du -h "$tmp/prod.dump" | cut -f1) empfangen"
elif [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Datei nicht gefunden: $BACKUP_FILE" >&2
  exit 1
fi

read -r -p "Lokale Datenbank '$DB_NAME' wird ersetzt. Fortfahren? [y/N] " answer
[[ "$answer" =~ ^[yYjJ]$ ]] || { echo "Abgebrochen."; exit 1; }

echo "→ Stoppe Backend und Backup …"
docker compose stop backend backup

echo "→ Lege Datenbank neu an …"
docker exec "$CONTAINER" dropdb   -U "$DB_USER" --if-exists --force "$DB_NAME"
docker exec "$CONTAINER" createdb -U "$DB_USER" "$DB_NAME"

echo "→ Spiele Dump ein …"
if [[ -z "$BACKUP_FILE" ]]; then
  docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges < "$tmp/prod.dump"
else
  gunzip -c "$BACKUP_FILE" \
    | docker exec -i "$CONTAINER" psql -q -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
fi

echo "→ Starte Stack …"
docker compose up -d

echo "✓ Fertig – Dev-DB enthält jetzt die Prod-Daten."
