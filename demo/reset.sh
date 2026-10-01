#!/bin/sh
# ============================================================
# Fahrtenbuch – reset the demo database
#
#   reset.sh once   reset once
#   reset.sh loop   now and then every RESET_INTERVAL_MINUTES (default)
#
# Runs in the "reset" container (postgres:16-alpine). Connection via
# PGHOST/PGDATABASE/PGUSER/PGPASSWORD. The schema is kept; seed.sql
# empties all data tables and recreates the demo data in a single
# transaction – visitors never see a half-finished state.
# ============================================================
set -eu

SEED=/demo/seed.sql

reset_demo() {
  seed_admin=false
  [ -n "${DEMO_ADMIN_PASSWORD:-}" ] && seed_admin=true

  psql -q -X -o /dev/null -v ON_ERROR_STOP=1 \
    -v demo_password="${DEMO_PASSWORD:-demo}" \
    -v admin_password="${DEMO_ADMIN_PASSWORD:-}" \
    -v seed_admin="$seed_admin" \
    -f "$SEED"
  echo "$(date '+%Y-%m-%d %H:%M:%S') Demo reset"
}

case "${1:-loop}" in
  once)
    reset_demo
    ;;
  loop)
    interval=$(( ${RESET_INTERVAL_MINUTES:-60} * 60 ))
    while true; do
      reset_demo || echo "$(date '+%Y-%m-%d %H:%M:%S') Reset failed" >&2
      sleep "$interval"
    done
    ;;
  *)
    echo "Usage: $0 [once|loop]" >&2
    exit 1
    ;;
esac
