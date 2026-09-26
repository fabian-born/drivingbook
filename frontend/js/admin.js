// js/admin.js

function zeigeAlert(text, typ = "success", id = "adminAlert") {
  const box = document.getElementById(id);
  box.className = `alert alert-${typ}`;
  box.textContent = text;
  box.classList.remove("d-none");
  setTimeout(() => box.classList.add("d-none"), 5000);
}

function formatDatum(iso) {
  return new Date(iso).toLocaleString(i18n.locale, {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

// ── Load user table ──────────────────────────────────────────

async function ladeUsers() {
  const res = await apiFetch(`/api/users`);

  if (res.status === 403) {
    document.getElementById("adminPanel").classList.add("d-none");
    document.getElementById("aufraeumenPanel").classList.add("d-none");
    document.getElementById("adminNoAccess").classList.remove("d-none");
    return;
  }

  const data  = await res.json();
  const laender = await ladeLaender();
  const ich   = tokenPayload()?.userId;
  const tbody = document.getElementById("userTabelle");

  const option = (wert, text, gewaehlt) =>
    `<option value="${escapeHtml(wert)}" ${wert === gewaehlt ? "selected" : ""}>${escapeHtml(text)}</option>`;

  tbody.innerHTML = data.map(u => `
    <tr data-user-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}">
      <td class="d-none d-sm-table-cell">${escapeHtml(u.id)}</td>
      <td><span class="mdi mdi-account me-1"></span>${escapeHtml(u.username)}</td>
      <td>
        <select class="form-select form-select-sm w-auto user-rolle" data-alt="${escapeHtml(u.role)}"
          aria-label="${escapeHtml(t("admin.users.role"))}" ${u.id === ich ? `disabled title="${escapeHtml(t("admin.users.ownRole"))}"` : ""}>
          ${option("user", t("admin.modal.roleUser"), u.role)}${option("admin", t("admin.modal.roleAdmin"), u.role)}
        </select>
      </td>
      <td>
        <select class="form-select form-select-sm w-auto user-land" data-alt="${escapeHtml(u.country)}"
          aria-label="${escapeHtml(t("admin.users.country"))}">
          ${[...new Set([...laender, u.country])].map(c => option(c, landName(c), u.country)).join("")}
        </select>
      </td>
      <td class="small text-muted d-none d-md-table-cell">${formatDatum(u.created_at)}</td>
    </tr>`).join("");
}

// Countries known to the tax comparison (groundwork for more countries)
async function ladeLaender() {
  try {
    const res = await apiFetch("/api/admin/countries");
    if (res.ok) return (await res.json()).countries;
  } catch { /* fallback below */ }
  return ["DE"];
}

// Save role or country immediately; revert to the old value on error
document.getElementById("userTabelle").addEventListener("change", async e => {
  const select = e.target.closest(".user-rolle, .user-land");
  if (!select) return;
  const zeile = select.closest("tr");
  const name  = zeile.dataset.username;
  const feld  = select.classList.contains("user-rolle") ? "role" : "country";

  if (feld === "role" && select.value === "admin" && !confirm(t("admin.users.confirmAdmin", { name }))) {
    select.value = select.dataset.alt;
    return;
  }
  select.disabled = true;
  try {
    const res = await apiFetch(`/api/admin/users/${zeile.dataset.userId}`, { method: "PATCH", body: { [feld]: select.value } });
    if (!res.ok) throw new Error(await apiError(res, t("admin.users.saveFailed")));
    select.dataset.alt = select.value;
    zeigeAlert(t("admin.users.saved", { name }));
  } catch (err) {
    select.value = select.dataset.alt;
    zeigeAlert(err.message, "danger");
  } finally {
    select.disabled = false;
  }
});

// ── New user (admin route) ───────────────────────────────────

const userModal = new bootstrap.Modal(document.getElementById("userModal"));

document.getElementById("btnNeuerUser").addEventListener("click", () => {
  document.getElementById("newUsername").value     = "";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newUserVehicle").value  = "";
  document.getElementById("newUserRole").value     = "user";
  document.getElementById("newUserTokenBox").classList.add("d-none");
  document.getElementById("userModalFooter").innerHTML = `
    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${t("admin.modal.cancel")}</button>
    <button type="button" class="btn btn-primary" id="btnUserSpeichern">${t("admin.modal.create")}</button>`;
  document.getElementById("btnUserSpeichern").addEventListener("click", erstelleUser);
  userModal.show();
});

async function erstelleUser() {
  const username    = document.getElementById("newUsername").value.trim();
  const password    = document.getElementById("newUserPassword").value;
  const vehicleName = document.getElementById("newUserVehicle").value.trim();
  const role        = document.getElementById("newUserRole").value;

  if (!username || !password) {
    zeigeAlert(t("admin.modal.required"), "danger", "userModalAlert");
    return;
  }
  if (password.length < 8) {
    zeigeAlert(t("register.tooShort"), "danger", "userModalAlert");
    return;
  }

  // Admin uses /api/users instead of /api/register so the role can be set
  // Vehicle + token are created separately afterwards
  const res  = await apiFetch(`/api/users`, {
    method: "POST",
    body: { username, password, role }
  });
  const data = await res.json();

  if (!res.ok) {
    zeigeAlert(data.error || t("admin.modal.createFailed"), "danger", "userModalAlert");
    return;
  }

  // Create the vehicle (not possible directly with the new user's token,
  // so we call the new /api/admin/users/:id/setup endpoint)
  if (vehicleName) {
    await apiFetch(`/api/admin/users/${data.id}/vehicle`, {
      method: "POST",
      body: { name: vehicleName }
    });
  }

  // Show default token
  document.getElementById("newUserToken").value = data.default_token;
  document.getElementById("newUserTokenBox").classList.remove("d-none");
  document.getElementById("userModalFooter").innerHTML = `
    <button type="button" class="btn btn-success" data-bs-dismiss="modal" onclick="ladeUsers()">${t("admin.modal.done")}</button>`;
}

// ── Init ─────────────────────────────────────────────────────
ladeUsers();

// ── Database cleanup ─────────────────────────────────────────

const datumZeit = iso => new Date(iso).toLocaleString(i18n.locale);

function aufraeumenMeldung(text, typ) {
  const box = document.getElementById("aufraeumenAlert");
  box.className   = `alert alert-${typ}`;
  box.textContent = text;
}

function fahrtZeile(f, status) {
  return `
    <tr class="${status === "behalten" ? "table-success" : ""}">
      <td>${status === "behalten" ? `<span class="badge bg-success">${t("admin.cleanup.keep")}</span>` : `<span class="badge bg-danger">${t("admin.cleanup.remove")}</span>`}</td>
      <td class="small">#${escapeHtml(f.id)}</td>
      <td class="small">${escapeHtml(datumZeit(f.timestamp))}</td>
      <td class="small">${escapeHtml(f.odometer_km)} km</td>
      <td class="small">${escapeHtml(f.destination)}</td>
      <td class="small">${tHtml("admin.cleanup.entries", { count: Number(f.audit_entries) })}</td>
    </tr>`;
}

function zeigeDuplikate({ groups: gruppen, to_remove: zu_entfernen }, sekunden) {
  document.getElementById("duplikatAnzahl").textContent = zu_entfernen;
  document.getElementById("duplikatRegel").textContent =
    t("admin.cleanup.rule", { minutes: sekunden / 60 });
  document.getElementById("btnDuplikateLoeschen").classList.toggle("d-none", gruppen.length === 0);

  document.getElementById("duplikatListe").innerHTML = gruppen.length === 0
    ? `<p class="text-success small mb-0"><span class="mdi mdi-check-circle me-1"></span>${t("admin.cleanup.noDuplicates")}</p>`
    : gruppen.map((g, i) => `
      <div class="border rounded p-2 mb-2">
        <div class="form-check mb-1">
          <input class="form-check-input duplikat-gruppe" type="checkbox" id="dup${i}" checked
            data-ids="${g.remove.map(f => f.id).join(",")}">
          <label class="form-check-label small fw-semibold" for="dup${i}">
            ${escapeHtml(g.username)} · ${escapeHtml(g.vehicle_name ?? t("admin.cleanup.withoutVehicle"))} · ${escapeHtml(fahrtartInfo(g.keep.trip_type).label)}
          </label>
        </div>
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <tbody>${fahrtZeile(g.keep, "behalten")}${g.remove.map(f => fahrtZeile(f, "entfernen")).join("")}</tbody>
          </table>
        </div>
      </div>`).join("");
}

function zeigeOhneFahrzeug(liste) {
  document.getElementById("ohneAnzahl").textContent = liste.reduce((n, o) => n + o.count, 0);
  document.getElementById("ohneListe").innerHTML = liste.length === 0
    ? `<p class="text-success small mb-0"><span class="mdi mdi-check-circle me-1"></span>${t("admin.cleanup.allAssigned")}</p>`
    : `<div class="list-group">${liste.map(o => `
        <div class="list-group-item ohne-eintrag" data-user="${o.user_id}">
          <div class="d-flex flex-wrap justify-content-between gap-2 mb-2">
            <strong>${escapeHtml(o.username)}</strong>
            <span class="small text-muted">${tHtml("admin.cleanup.tripsRange", { count: Number(o.count), first: formatDatum(o.first), last: formatDatum(o.last) })}</span>
          </div>
          <div class="d-flex flex-column flex-sm-row gap-2">
            <select class="form-select form-select-sm ohne-ziel" data-user="${o.user_id}" aria-label="${tHtml("admin.cleanup.vehicleOf", { name: o.username })}"
              ${o.vehicles.length ? "" : "disabled"}>
              ${o.vehicles.length
                ? o.vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (${escapeHtml(v.code)})</option>`).join("")
                : `<option>${t("admin.cleanup.noVehicle")}</option>`}
            </select>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-outline-primary flex-grow-1 text-nowrap ohne-zuordnen" data-user="${o.user_id}" data-name="${escapeHtml(o.username)}"
                data-anzahl="${o.count}" ${o.vehicles.length ? "" : "disabled"}>${t("admin.cleanup.assign")}</button>
              <button class="btn btn-sm btn-outline-danger ohne-loeschen" data-user="${o.user_id}" data-name="${escapeHtml(o.username)}"
                data-anzahl="${o.count}" title="${t("admin.cleanup.deleteTrips")}" aria-label="${t("admin.cleanup.deleteTrips")}"><span class="mdi mdi-delete"></span></button>
            </div>
          </div>
        </div>`).join("")}</div>`;
}

async function pruefeDatenbank() {
  const res = await apiFetch("/api/admin/cleanup");
  if (!res.ok) return aufraeumenMeldung(await apiError(res), "danger");
  const bericht = await res.json();

  document.getElementById("aufraeumenStart").classList.add("d-none");
  document.getElementById("aufraeumenErgebnis").classList.remove("d-none");
  zeigeDuplikate(bericht.duplicates, bericht.duplicate_seconds);
  zeigeOhneFahrzeug(bericht.unassigned);
}

document.getElementById("btnPruefen").addEventListener("click", () => {
  document.getElementById("aufraeumenAlert").classList.add("d-none");
  pruefeDatenbank();
});

document.getElementById("btnDuplikateLoeschen").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".duplikat-gruppe:checked")]
    .flatMap(c => c.dataset.ids.split(",").map(Number));
  if (ids.length === 0) return aufraeumenMeldung(t("admin.cleanup.noGroup"), "warning");
  if (!confirm(`${t("admin.cleanup.confirmDeleteDuplicates", { count: ids.length })} ${t("admin.cleanup.auditHint")}`)) return;

  const res = await apiFetch("/api/admin/cleanup/duplicates", { method: "POST", body: { ids } });
  if (!res.ok) return aufraeumenMeldung(await apiError(res), "danger");
  const { removed: entfernt, rejected: abgelehnt } = await res.json();
  aufraeumenMeldung(t("admin.cleanup.duplicatesDeleted", { count: Number(entfernt) }) +
    (abgelehnt.length ? t("admin.cleanup.skipped", { count: abgelehnt.length }) : "."), "success");
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
    if (!confirm(t("admin.cleanup.confirmAssign", { count: Number(btn.dataset.anzahl), name: btn.dataset.name, vehicle: name }))) return;
    body = { user_id, action: "assign", vehicle_id: Number(select.value) };
  } else {
    if (!confirm(`${t("admin.cleanup.confirmDeleteUnassigned", { count: Number(btn.dataset.anzahl), name: btn.dataset.name })}\n` +
                 t("admin.cleanup.auditHint"))) return;
    body = { user_id, action: "delete" };
  }

  const res = await apiFetch("/api/admin/cleanup/unassigned", { method: "POST", body });
  if (!res.ok) return aufraeumenMeldung(await apiError(res), "danger");
  const { count: anzahl } = await res.json();
  aufraeumenMeldung(t(zuordnen ? "admin.cleanup.assigned" : "admin.cleanup.deleted", { count: Number(anzahl) }), "success");
  pruefeDatenbank();
});
