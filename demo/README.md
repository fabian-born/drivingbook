# Fahrtenbuch – demo environment

A standalone stack next to production (own Compose project name, own
containers `fahrtenbuch-demo-*`, own network, own database). The database
is reset to fixed demo data at regular intervals.

| File | Purpose |
|---|---|
| `docker-compose.yml` | db, backend, frontend (Traefik) and the reset container |
| `.env.example` | template for `.env` |
| `seed.sql` | demo data: users, vehicles, trips from January 1 of the previous year until today |
| `reset.sh` | loads `seed.sql` – once (`once`) or in a loop (`loop`) |

## Deployment

Copy the `demo/` folder to the Docker host, then:

```bash
cp .env.example .env      # set tags, domain, DB_PASSWORD, JWT_SECRET, passwords
docker compose up -d
docker compose logs -f reset
```

On the first start the backend creates the schema. As soon as it is healthy,
the reset container loads the demo data – and again every
`RESET_INTERVAL_MINUTES` (default 60).

## Logins

| User | Password | Role |
|---|---|---|
| `demo` | `DEMO_PASSWORD` (default `demo`) | user, 2 vehicles (combustion + electric) |
| `admin` | `DEMO_ADMIN_PASSWORD` | admin, 1 hybrid – only if the password is set |

## Reset

```bash
docker compose exec reset /demo/reset.sh once    # reset now
```

The reset empties all data tables and recreates the demo data in **one
transaction**; the schema (and `schema_migrations`) is kept. New migrations
are applied by the backend on start with a new image, as usual.

- Users and vehicles have fixed IDs and codes (`DEMPKW`, `DEMEV2`, `ADMHYB`):
  whoever is logged in as `demo` stays logged in and simply sees the fresh
  data after the reset.
- The ID sequences keep counting – users created by visitors never get an
  ID that is handed out again later (no access through old sessions).
- The random data is the same on every reset (`setseed`), only relative to
  the current date.

To reset at fixed times instead of an interval (e.g. at night): run `reset`
with `command: ["once"]` and `restart: "no"` and start it from a host cron job:

```cron
0 3 * * * cd /path/to/demo && docker compose run --rm reset once
```

## Update

Change `FRONTEND_TAG`/`BACKEND_TAG` in `.env`, then `docker compose up -d`.
If new migrations change the schema, `seed.sql` may have to be adjusted
(otherwise the reset fails and logs "Reset failed").

## GitHub Pages

The public demo page is `docs/demo.html` (linked from `docs/index.html`).
It points to `https://demo.example.com/` – replace it with the real
`DEMO_DOMAIN` (two places: the "Open the demo" button and the API example).
If you change `DEMO_PASSWORD` or `RESET_INTERVAL_MINUTES`, update the page too.
