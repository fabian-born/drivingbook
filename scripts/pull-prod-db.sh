#!/usr/bin/env bash
# ============================================================
# Fahrtenbuch – Prod-Datenbank in die Dev-DB einspielen
#
#   ./scripts/pull-prod-db.sh                 frischer Dump per SSH
#   ./scripts/pull-prod-db.sh backup.sql.gz   vorhandenes Tages-Backup (lokale Datei)
#
# Das Script kann auf jedem Rechner laufen, der per SSH auf beide Hosts kommt.
# Docker wird auf dem Dev-Host per sudo aufgerufen.
#
# Umgebungsvariablen:
#   PROD_HOST   SSH-Ziel des Prod-Hosts (Standard: docker-host-01)
#   DEV_HOST    SSH-Ziel des Dev-Hosts  (Standard: marder)
#   DB_NAME     Datenbankname           (Standard: fahrtenbuch)
#   DB_USER     Datenbank-User          (Standard: fahrtenbuch)
#
# ACHTUNG: Die Dev-Datenbank auf $DEV_HOST wird komplett ersetzt!
# ============================================================
set -euo pipefail

PROD_HOST="${PROD_HOST:-docker-host-01}"
DEV_HOST="${DEV_HOST:-marder}"
DB_NAME="${DB_NAME:-fahrtenbuch}"
DB_USER="${DB_USER:-fahrtenbuch}"
CONTAINER="fahrtenbuch-db"
STOP_CONTAINERS=(fahrtenbuch-backend fahrtenbuch-backup)
BACKUP_FILE="${1:-}"

# docker auf dem Dev-Host ausführen
dev_docker() {
  ssh "$DEV_HOST" sudo docker "$(printf '%q ' "$@")"
}

# Schutz: niemals die Prod-Datenbank überschreiben
prod_name="$(ssh "$PROD_HOST" hostname)"
dev_name="$(ssh "$DEV_HOST" hostname)"
if [[ "$prod_name" == "$dev_name" ]]; then
  echo "DEV_HOST ($DEV_HOST) und PROD_HOST ($PROD_HOST) sind derselbe Rechner ($dev_name) – Abbruch." >&2
  exit 1
fi

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

read -r -p "Datenbank '$DB_NAME' auf $dev_name wird ersetzt. Fortfahren? [y/N] " answer
[[ "$answer" =~ ^[yYjJ]$ ]] || { echo "Abgebrochen."; exit 1; }

echo "→ Stoppe Backend und Backup auf $dev_name …"
dev_docker stop "${STOP_CONTAINERS[@]}"

echo "→ Lege Datenbank neu an …"
dev_docker exec "$CONTAINER" dropdb   -U "$DB_USER" --if-exists --force "$DB_NAME"
dev_docker exec "$CONTAINER" createdb -U "$DB_USER" "$DB_NAME"

echo "→ Spiele Dump ein …"
if [[ -z "$BACKUP_FILE" ]]; then
  dev_docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges < "$tmp/prod.dump"
else
  gunzip -c "$BACKUP_FILE" \
    | dev_docker exec -i "$CONTAINER" psql -q -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
fi

echo "→ Starte Backend und Backup …"
dev_docker start "${STOP_CONTAINERS[@]}"

echo "✓ Fertig – Dev-DB auf $dev_name enthält jetzt die Prod-Daten."
