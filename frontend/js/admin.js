// js/admin.js

function zeigeAlert(text, typ = "success", id = "adminAlert") {
  const box = document.getElementById(id);
  box.className = `alert alert-${typ}`;
  box.textContent = text;
  box.classList.remove("d-none");
  setTimeout(() => box.classList.add("d-none"), 5000);
}

function formatDatum(iso) {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

// ── User-Tabelle laden ───────────────────────────────────────

async function ladeUsers() {
  const res = await apiFetch(`/api/users`);

  if (res.status === 403) {
    document.getElementById("adminPanel").classList.add("d-none");
    document.getElementById("aufraeumenPanel").classList.add("d-none");
    document.getElementById("adminNoAccess").classList.remove("d-none");
    return;
  }

  const data  = await res.json();
  const tbody = document.getElementById("userTabelle");

  tbody.innerHTML = data.map(u => `
    <tr>
      <td>${escapeHtml(u.id)}</td>
      <td><span class="mdi mdi-account me-1"></span>${escapeHtml(u.username)}</td>
      <td>
        <span class="badge ${u.role === 'admin' ? 'bg-danger' : 'bg-secondary'}">
          ${escapeHtml(u.role)}
        </span>
      </td>
      <td class="small text-muted">${formatDatum(u.created_at)}</td>
    </tr>`).join("");
}

// ── Neuer User (Admin-Weg) ───────────────────────────────────

const userModal = new bootstrap.Modal(document.getElementById("userModal"));

document.getElementById("btnNeuerUser").addEventListener("click", () => {
  document.getElementById("newUsername").value     = "";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newUserVehicle").value  = "";
  document.getElementById("newUserRole").value     = "user";
  document.getElementById("newUserTokenBox").classList.add("d-none");
  document.getElementById("userModalFooter").innerHTML = `
    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
    <button type="button" class="btn btn-primary" id="btnUserSpeichern">Anlegen</button>`;
  document.getElementById("btnUserSpeichern").addEventListener("click", erstelleUser);
  userModal.show();
});

async function erstelleUser() {
  const username    = document.getElementById("newUsername").value.trim();
  const password    = document.getElementById("newUserPassword").value;
  const vehicleName = document.getElementById("newUserVehicle").value.trim();
  const role        = document.getElementById("newUserRole").value;

  if (!username || !password) {
    zeigeAlert("Benutzername und Passwort erforderlich.", "danger", "userModalAlert");
    return;
  }
  if (password.length < 8) {
    zeigeAlert("Passwort muss mindestens 8 Zeichen haben.", "danger", "userModalAlert");
    return;
  }

  // Admin nutzt /api/users statt /api/register, um Rolle setzen zu können
  // Fahrzeug + Token werden danach separat angelegt
  const res  = await apiFetch(`/api/users`, {
    method: "POST",
    body: { username, password, role }
  });
  const data = await res.json();

  if (!res.ok) {
    zeigeAlert(data.error || "Fehler beim Anlegen.", "danger", "userModalAlert");
    return;
  }

  // Fahrzeug anlegen (mit dem neuen User-Token geht das nicht direkt,
  // daher rufen wir den neuen /api/admin/users/:id/setup Endpoint auf)
  if (vehicleName) {
    await apiFetch(`/api/admin/users/${data.id}/vehicle`, {
      method: "POST",
      body: { name: vehicleName }
    });
  }

  // Default-Token anzeigen
  document.getElementById("newUserToken").value = data.default_token;
  document.getElementById("newUserTokenBox").classList.remove("d-none");
  document.getElementById("userModalFooter").innerHTML = `
    <button type="button" class="btn btn-success" data-bs-dismiss="modal" onclick="ladeUsers()">Fertig</button>`;
}

// ── Init ─────────────────────────────────────────────────────
ladeUsers();

// ── Datenbank aufräumen ──────────────────────────────────────

const datumZeit = iso => new Date(iso).toLocaleString("de-DE");

function aufraeumenMeldung(text, typ) {
  const box = document.getElementById("aufraeumenAlert");
  box.className   = `alert alert-${typ}`;
  box.textContent = text;
}

function fahrtZeile(f, status) {
  return `
    <tr class="${status === "behalten" ? "table-success" : ""}">
      <td>${status === "behalten" ? '<span class="badge bg-success">behalten</span>' : '<span class="badge bg-danger">entfernen</span>'}</td>
      <td class="small">#${escapeHtml(f.id)}</td>
      <td class="small">${escapeHtml(datumZeit(f.timestamp))}</td>
      <td class="small">${escapeHtml(f.kmstand)} km</td>
      <td class="small">${escapeHtml(f.ziel)}</td>
      <td class="small">${escapeHtml(f.protokoll)} Einträge</td>
    </tr>`;
}

function zeigeDuplikate({ gruppen, zu_entfernen }, sekunden) {
  document.getElementById("duplikatAnzahl").textContent = zu_entfernen;
  document.getElementById("duplikatRegel").textContent =
    `Gleicher Benutzer, gleiches Fahrzeug, gleicher km-Stand, gleiches Ziel und gleiche Fahrtart, höchstens ` +
    `${sekunden / 60} Minuten auseinander. Behalten wird die Fahrt mit dem meisten Änderungsverlauf, sonst die älteste.`;
  document.getElementById("btnDuplikateLoeschen").classList.toggle("d-none", gruppen.length === 0);

  document.getElementById("duplikatListe").innerHTML = gruppen.length === 0
    ? `<p class="text-success small mb-0"><span class="mdi mdi-check-circle me-1"></span>Keine doppelten Fahrten gefunden.</p>`
    : gruppen.map((g, i) => `
      <div class="border rounded p-2 mb-2">
        <div class="form-check mb-1">
          <input class="form-check-input duplikat-gruppe" type="checkbox" id="dup${i}" checked
            data-ids="${g.entfernen.map(f => f.id).join(",")}">
          <label class="form-check-label small fw-semibold" for="dup${i}">
            ${escapeHtml(g.username)} · ${escapeHtml(g.vehicle_name ?? "ohne Fahrzeug")} · ${escapeHtml(fahrtartInfo(g.behalten.fahrtart).label)}
          </label>
        </div>
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <tbody>${fahrtZeile(g.behalten, "behalten")}${g.entfernen.map(f => fahrtZeile(f, "entfernen")).join("")}</tbody>
          </table>
        </div>
      </div>`).join("");
}

function zeigeOhneFahrzeug(liste) {
  document.getElementById("ohneAnzahl").textContent = liste.reduce((n, o) => n + o.anzahl, 0);
  document.getElementById("ohneListe").innerHTML = liste.length === 0
    ? `<p class="text-success small mb-0"><span class="mdi mdi-check-circle me-1"></span>Alle Fahrten sind einem Fahrzeug zugeordnet.</p>`
    : `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
        <thead><tr><th>Benutzer</th><th>Fahrten</th><th>Zeitraum</th><th>Aktion</th></tr></thead>
        <tbody>${liste.map(o => `
          <tr>
            <td>${escapeHtml(o.username)}</td>
            <td>${escapeHtml(o.anzahl)}</td>
            <td class="small">${escapeHtml(formatDatum(o.erste))} – ${escapeHtml(formatDatum(o.letzte))}</td>
            <td>
              <div class="input-group input-group-sm flex-nowrap">
                <select class="form-select form-select-sm ohne-ziel" data-user="${o.user_id}" ${o.fahrzeuge.length ? "" : "disabled"}>
                  ${o.fahrzeuge.length
                    ? o.fahrzeuge.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (${escapeHtml(v.code)})</option>`).join("")
                    : "<option>kein Fahrzeug vorhanden</option>"}
                </select>
                <button class="btn btn-outline-primary ohne-zuordnen" data-user="${o.user_id}" data-name="${escapeHtml(o.username)}"
                  data-anzahl="${o.anzahl}" ${o.fahrzeuge.length ? "" : "disabled"}>Zuordnen</button>
                <button class="btn btn-outline-danger ohne-loeschen" data-user="${o.user_id}" data-name="${escapeHtml(o.username)}"
                  data-anzahl="${o.anzahl}" title="Fahrten löschen"><span class="mdi mdi-delete"></span></button>
              </div>
            </td>
          </tr>`).join("")}</tbody></table></div>`;
}

async function pruefeDatenbank() {
  const res = await apiFetch("/api/admin/aufraeumen");
  if (!res.ok) return aufraeumenMeldung(await apiError(res), "danger");
  const bericht = await res.json();

  document.getElementById("aufraeumenStart").classList.add("d-none");
  document.getElementById("aufraeumenErgebnis").classList.remove("d-none");
  zeigeDuplikate(bericht.duplikate, bericht.duplikat_sekunden);
  zeigeOhneFahrzeug(bericht.ohne_fahrzeug);
}

document.getElementById("btnPruefen").addEventListener("click", () => {
  document.getElementById("aufraeumenAlert").classList.add("d-none");
  pruefeDatenbank();
});

document.getElementById("btnDuplikateLoeschen").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".duplikat-gruppe:checked")]
    .flatMap(c => c.dataset.ids.split(",").map(Number));
  if (ids.length === 0) return aufraeumenMeldung("Keine Gruppe ausgewählt.", "warning");
  if (!confirm(`${ids.length} doppelte Fahrt(en) löschen? Die Löschung wird im Änderungsprotokoll festgehalten.`)) return;

  const res = await apiFetch("/api/admin/aufraeumen/duplikate", { method: "POST", body: { ids } });
  if (!res.ok) return aufraeumenMeldung(await apiError(res), "danger");
  const { entfernt, abgelehnt } = await res.json();
  aufraeumenMeldung(`✅ ${entfernt} doppelte Fahrt(en) gelöscht` +
    (abgelehnt.length ? ` – ${abgelehnt.length} nicht mehr doppelt, übersprungen.` : "."), "success");
  pruefeDatenbank();
});

document.getElementById("ohneListe").addEventListener("click", async e => {
  const zuordnen = e.target.closest(".ohne-zuordnen");
  const loeschen = e.target.closest(".ohne-loeschen");
  const btn = zuordnen ?? loeschen;
  if (!btn) return;

  const user_id = Number(btn.dataset.user);
  let body;
  if (zuordnen) {
    const select = document.querySelector(`.ohne-ziel[data-user="${user_id}"]`);
    const name   = select.selectedOptions[0].textContent;
    if (!confirm(`${btn.dataset.anzahl} Fahrt(en) von „${btn.dataset.name}“ dem Fahrzeug ${name} zuordnen?`)) return;
    body = { user_id, aktion: "zuordnen", vehicle_id: Number(select.value) };
  } else {
    if (!confirm(`${btn.dataset.anzahl} Fahrt(en) ohne Fahrzeug von „${btn.dataset.name}“ endgültig löschen?\n` +
                 "Die Löschung wird im Änderungsprotokoll festgehalten.")) return;
    body = { user_id, aktion: "loeschen" };
  }

  const res = await apiFetch("/api/admin/aufraeumen/ohne-fahrzeug", { method: "POST", body });
  if (!res.ok) return aufraeumenMeldung(await apiError(res), "danger");
  const { anzahl } = await res.json();
  aufraeumenMeldung(`✅ ${anzahl} Fahrt(en) ${zuordnen ? "zugeordnet" : "gelöscht"}.`, "success");
  pruefeDatenbank();
});
