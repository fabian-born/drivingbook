# API auf Englisch umstellen – Plan & Fortschritt

Ziel: API-Pfade, Feldnamen und Werte englisch – wie die Datenbank seit Migration 011.
**Deutsch bleiben:** Fehlermeldungen, Oberfläche, CSV-/PDF-Beschriftungen, Dateinamen.

> ⚠️ Zwischen Schritt 2 und 3 passen Frontend und Backend nicht zusammen.
> **Erst deployen, wenn Schritt 3 abgehakt ist** (Frontend + Backend gemeinsam).

## Fortschritt

- [x] 1. Plan (dieses Dokument)
- [x] 2a. Backend-Code: Routen, Eingaben, Antworten englisch; `lib/dbschema.js` entfernt
      (API = DB-Namen); Übergangsadresse `POST /api/fahrt` (deutsch, für Home Assistant);
      Sicherungsformat v2 (englisch) + Import von v1 (`lib/altformat.js`)
- [ ] 2b. Backend-Tests auf die neue API umstellen (+ Tests für `POST /api/fahrt` und v1-Import); grün
- [ ] 3. Frontend auf die neue API; Browser-Tests grün
- [ ] 4. Offline-Warteschlange: alte Einträge beim Start umschreiben; README/HA-Doku; Aufräumen

Weitermachen: Checkliste oben, dann `git log --oneline` – jeder Schritt ist ein Commit
„API englisch – Schritt N: …“. Tests: siehe `backend/README.md` und `e2e/README.md`
(Testdatenbank z. B. `docker run -d --rm --name drivingbook-testdb -e POSTGRES_USER=fahrtenbuch
-e POSTGRES_PASSWORD=test -e POSTGRES_DB=fahrtenbuch_test -p 127.0.0.1:55432:5432 postgres:16-alpine`).

## Routen

| alt | neu |
|---|---|
| `POST /api/fahrt` | `POST /api/trips` (alt bleibt als Übergang für Home Assistant, deutsche Felder) |
| `PUT /api/fahrt/:id` | `PUT /api/trips/:id` |
| `DELETE /api/fahrt/:id` | `DELETE /api/trips/:id` |
| `GET /api/fahrt/:id/history` | `GET /api/trips/:id/history` |
| `GET /api/fahrten?year=` | `GET /api/trips?year=` |
| `GET /api/admin/aufraeumen` | `GET /api/admin/cleanup` |
| `POST /api/admin/aufraeumen/duplikate` | `POST /api/admin/cleanup/duplicates` |
| `POST /api/admin/aufraeumen/ohne-fahrzeug` | `POST /api/admin/cleanup/unassigned` |
| `GET /api/vehicles/:id/pruefung` | `GET /api/vehicles/:id/check` |
| `DELETE /api/vehicles/:id?ziel=` | `DELETE /api/vehicles/:id?target=` |

Unverändert: `/api/audit`, `/api/export/*`, `/api/vehicles…` (übrige), `/api/backup…`,
`/api/login`, `/api/register`, `/api/profile`, `/api/tokens`, `/api/users…`, `/api/health`.

## Felder & Werte

**Fahrt:** `_id`→`id`, `kmstand`→`odometer_km`, `ziel`→`destination`, `fahrtart`→`trip_type`,
`strecke`→`distance`, `monat`→`month` · Werte `privat/geschäftlich/arbeitsweg` →
`private/business/commute`

**Jahres-Liste `GET /api/trips`:** `monate`→`months`, `summe`→`totals`, `fahrten`→`trips`;
Summen: `fahrten`→`trips`, `gesamt`→`total`, `privat/geschaeftlich/arbeitsweg`→`private/business/commute`

**Protokoll:** `fahrt_id`→`trip_id`; `old_data`/`new_data` mit `odometer_km`, `destination`, `trip_type`

**Auto-Info `GET /vehicles/:id/info`:** `gesamt`→`overall` (`fahrten`→`trips`, `erste_fahrt`→`first_trip`,
`letzte_fahrt`→`last_trip`, `km_aktuell`→`odometer_current`), `jahr`→`year_totals`, `kosten`→`costs`,
`vergleich`→`comparison` (`satz`→`rate`, `listenpreis`→`list_price`, `kosten_gesamt`→`total_costs`,
`pauschal`→`flat_rate` {`privatnutzung`→`private_use`, `arbeitsweg`→`commute`, `gedeckelt`→`capped`,
`summe`→`total`}, `fahrtenbuch`→`logbook` {`privat_anteil`→`private_share`, `summe`→`total`},
`break_even_anteil`→`break_even_share`, `differenz`→`difference`, `empfehlung`→`recommendation`
(`fahrtenbuch`/`pauschal` → `logbook`/`flat_rate`), `steuer_ersparnis`→`tax_savings`)

**Antriebsart:** `verbrenner/hybrid/elektro/elektro_teuer` → `combustion/hybrid/electric/electric_high_price`

**Prüfung `…/check`:** `ampel`→`status` (`gruen/gelb/rot`→`green/yellow/red`), `befunde`→`findings`
{`stufe`→`level` (`fehler/warnung/hinweis`→`error/warning/info`), `typ`→`type`, `text` (deutsch),
`fahrt_id`→`trip_id`, `kmstand`→`odometer_km`}; Typen `rueckschritt/zukunft/luecke/grosse_strecke/
koordinaten/ohne_fahrzeug/geaendert/geloescht/leer` → `odometer_decrease/future/gap/long_distance/
coordinates/unassigned/edited/deleted/empty`

**Sicherung v2:** Fahrzeug `{format:"drivingbook-vehicle", version:2, created_at, vehicle, years, trips, audit}`,
Gesamt `{format:"drivingbook-backup", version:2, created_at, vehicles:[{vehicle, years, trips, audit}], unassigned:{trips, audit}}`.
v1 (`drivingbook-fahrzeug`/`drivingbook-sicherung`, deutsche Felder) wird beim Import übersetzt.
Ergebnis: `neu`→`created`, `importiert`→`imported` {`fahrten`→`trips`, `zugeordnet`→`reassigned`,
`uebersprungen`→`skipped`, `jahre`→`years`, `protokoll`→`audit`}; Gesamt: `fahrzeuge`→`vehicles`,
`ohne_fahrzeug`→`unassigned`

**Sicherungsstatus:** `erinnerung_tage`→`reminder_days`, `erinnern`→`remind`, `fahrzeuge`→`vehicles`,
`aenderungen`→`changes`

**Fahrzeug löschen:** `verschoben`→`moved`; 409 `HAT_FAHRTEN` → `HAS_TRIPS` mit `count`

**Admin-Aufräumen:** `duplikat_sekunden`→`duplicate_seconds`, `duplikate`→`duplicates`
{`gruppen`→`groups` {`behalten`→`keep`, `entfernen`→`remove`}, `zu_entfernen`→`to_remove`},
`ohne_fahrzeug`→`unassigned` {`anzahl`→`count`, `erste`→`first`, `letzte`→`last`, `fahrzeuge`→`vehicles`};
Fahrt-Einträge `protokoll`→`audit_entries`; Body `aktion: zuordnen/loeschen` → `action: assign/delete`;
Ergebnisse `entfernt/abgelehnt`→`removed/rejected`, `anzahl`→`count`
