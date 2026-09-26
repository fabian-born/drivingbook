// js/admin.js

function showAlert(text, type = "success", id = "adminAlert") {
  const box = document.getElementById(id);
  box.className = `alert alert-${type}`;
  box.textContent = text;
  box.classList.remove("d-none");
  setTimeout(() => box.classList.add("d-none"), 5000);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(i18n.locale, {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

// ── Load user table ──────────────────────────────────────────

async function loadUsers() {
  const res = await apiFetch(`/api/users`);

  if (res.status === 403) {
    document.getElementById("adminPanel").classList.add("d-none");
    document.getElementById("cleanupPanel").classList.add("d-none");
    document.getElementById("adminNoAccess").classList.remove("d-none");
    return;
  }

  const data  = await res.json();
  const countries = await loadCountries();
  const currentUserId   = tokenPayload()?.userId;
  const tbody = document.getElementById("userTabelle");

  const option = (rawValue, text, selectedValue) =>
    `<option value="${escapeHtml(rawValue)}" ${rawValue === selectedValue ? "selected" : ""}>${escapeHtml(text)}</option>`;

  tbody.innerHTML = data.map(u => `
    <tr data-user-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}">
      <td class="d-none d-sm-table-cell">${escapeHtml(u.id)}</td>
      <td><span class="mdi mdi-account me-1"></span>${escapeHtml(u.username)}</td>
      <td>
        <select class="form-select form-select-sm w-auto user-role" data-previous="${escapeHtml(u.role)}"
          aria-label="${escapeHtml(t("admin.users.role"))}" ${u.id === currentUserId ? `disabled title="${escapeHtml(t("admin.users.ownRole"))}"` : ""}>
          ${option("user", t("admin.modal.roleUser"), u.role)}${option("admin", t("admin.modal.roleAdmin"), u.role)}
        </select>
      </td>
      <td>
        <select class="form-select form-select-sm w-auto user-country" data-previous="${escapeHtml(u.country)}"
          aria-label="${escapeHtml(t("admin.users.country"))}">
          ${[...new Set([...countries, u.country])].map(c => option(c, countryName(c), u.country)).join("")}
        </select>
      </td>
      <td class="small text-muted d-none d-md-table-cell">${formatDate(u.created_at)}</td>
    </tr>`).join("");
}

// Countries known to the tax comparison (groundwork for more countries)
async function loadCountries() {
  try {
    const res = await apiFetch("/api/admin/countries");
    if (res.ok) return (await res.json()).countries;
  } catch { /* fallback below */ }
  return ["DE"];
}

// Save role or country immediately; revert to the old value on error
document.getElementById("userTabelle").addEventListener("change", async e => {
  const select = e.target.closest(".user-role, .user-country");
  if (!select) return;
  const rowEl = select.closest("tr");
  const name  = rowEl.dataset.username;
  const fieldName  = select.classList.contains("user-role") ? "role" : "country";

  if (fieldName === "role" && select.value === "admin" && !confirm(t("admin.users.confirmAdmin", { name }))) {
    select.value = select.dataset.previous;
    return;
  }
  select.disabled = true;
  try {
    const res = await apiFetch(`/api/admin/users/${rowEl.dataset.userId}`, { method: "PATCH", body: { [fieldName]: select.value } });
    if (!res.ok) throw new Error(await apiError(res, t("admin.users.saveFailed")));
    select.dataset.previous = select.value;
    showAlert(t("admin.users.saved", { name }));
  } catch (err) {
    select.value = select.dataset.previous;
    showAlert(err.message, "danger");
  } finally {
    select.disabled = false;
  }
});

// ── New user (admin route) ───────────────────────────────────

const userModal = new bootstrap.Modal(document.getElementById("userModal"));

document.getElementById("btnNewUser").addEventListener("click", () => {
  document.getElementById("newUsername").value     = "";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newUserVehicle").value  = "";
  document.getElementById("newUserRole").value     = "user";
  document.getElementById("newUserTokenBox").classList.add("d-none");
  document.getElementById("userModalFooter").innerHTML = `
    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${t("admin.modal.cancel")}</button>
    <button type="button" class="btn btn-primary" id="btnSaveUser">${t("admin.modal.create")}</button>`;
  document.getElementById("btnSaveUser").addEventListener("click", createUser);
  userModal.show();
});

async function createUser() {
  const username    = document.getElementById("newUsername").value.trim();
  const password    = document.getElementById("newUserPassword").value;
  const vehicleName = document.getElementById("newUserVehicle").value.trim();
  const role        = document.getElementById("newUserRole").value;

  if (!username || !password) {
    showAlert(t("admin.modal.required"), "danger", "userModalAlert");
    return;
  }
  if (password.length < 8) {
    showAlert(t("register.tooShort"), "danger", "userModalAlert");
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
    showAlert(data.error || t("admin.modal.createFailed"), "danger", "userModalAlert");
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
loadUsers();

// ── Database cleanup ─────────────────────────────────────────

const dateTime = iso => new Date(iso).toLocaleString(i18n.locale);

function showCleanupMessage(text, type) {
  const box = document.getElementById("cleanupAlert");
  box.className   = `alert alert-${type}`;
  box.textContent = text;
}

function tripRow(f, status) {
  return `
    <tr class="${status === "behalten" ? "table-success" : ""}">
      <td>${status === "behalten" ? `<span class="badge bg-success">${t("admin.cleanup.keep")}</span>` : `<span class="badge bg-danger">${t("admin.cleanup.remove")}</span>`}</td>
      <td class="small">#${escapeHtml(f.id)}</td>
      <td class="small">${escapeHtml(dateTime(f.timestamp))}</td>
      <td class="small">${escapeHtml(f.odometer_km)} km</td>
      <td class="small">${escapeHtml(f.destination)}</td>
      <td class="small">${tHtml("admin.cleanup.entries", { count: Number(f.audit_entries) })}</td>
    </tr>`;
}

function showDuplicates({ groups: groups, to_remove: toRemove }, seconds) {
  document.getElementById("duplicateCount").textContent = toRemove;
  document.getElementById("duplicateRule").textContent =
    t("admin.cleanup.rule", { minutes: seconds / 60 });
  document.getElementById("btnDeleteDuplicates").classList.toggle("d-none", groups.length === 0);

  document.getElementById("duplicateList").innerHTML = groups.length === 0
    ? `<p class="text-success small mb-0"><span class="mdi mdi-check-circle me-1"></span>${t("admin.cleanup.noDuplicates")}</p>`
    : groups.map((g, i) => `
      <div class="border rounded p-2 mb-2">
        <div class="form-check mb-1">
          <input class="form-check-input duplicate-group" type="checkbox" id="dup${i}" checked
            data-ids="${g.remove.map(f => f.id).join(",")}">
          <label class="form-check-label small fw-semibold" for="dup${i}">
            ${escapeHtml(g.username)} · ${escapeHtml(g.vehicle_name ?? t("admin.cleanup.withoutVehicle"))} · ${escapeHtml(tripTypeInfo(g.keep.trip_type).label)}
          </label>
        </div>
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <tbody>${tripRow(g.keep, "behalten")}${g.remove.map(f => tripRow(f, "entfernen")).join("")}</tbody>
          </table>
        </div>
      </div>`).join("");
}

function showWithoutVehicle(listEl) {
  document.getElementById("unassignedCount").textContent = listEl.reduce((n, o) => n + o.count, 0);
  document.getElementById("unassignedList").innerHTML = listEl.length === 0
    ? `<p class="text-success small mb-0"><span class="mdi mdi-check-circle me-1"></span>${t("admin.cleanup.allAssigned")}</p>`
    : `<div class="list-group">${listEl.map(o => `
        <div class="list-group-item unassigned-entry" data-user="${o.user_id}">
          <div class="d-flex flex-wrap justify-content-between gap-2 mb-2">
            <strong>${escapeHtml(o.username)}</strong>
            <span class="small text-muted">${tHtml("admin.cleanup.tripsRange", { count: Number(o.count), first: formatDate(o.first), last: formatDate(o.last) })}</span>
          </div>
          <div class="d-flex flex-column flex-sm-row gap-2">
            <select class="form-select form-select-sm unassigned-target" data-user="${o.user_id}" aria-label="${tHtml("admin.cleanup.vehicleOf", { name: o.username })}"
              ${o.vehicles.length ? "" : "disabled"}>
              ${o.vehicles.length
                ? o.vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (${escapeHtml(v.code)})</option>`).join("")
                : `<option>${t("admin.cleanup.noVehicle")}</option>`}
            </select>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-outline-primary flex-grow-1 text-nowrap unassigned-assign" data-user="${o.user_id}" data-name="${escapeHtml(o.username)}"
                data-count="${o.count}" ${o.vehicles.length ? "" : "disabled"}>${t("admin.cleanup.assign")}</button>
              <button class="btn btn-sm btn-outline-danger unassigned-delete" data-user="${o.user_id}" data-name="${escapeHtml(o.username)}"
                data-count="${o.count}" title="${t("admin.cleanup.deleteTrips")}" aria-label="${t("admin.cleanup.deleteTrips")}"><span class="mdi mdi-delete"></span></button>
            </div>
          </div>
        </div>`).join("")}</div>`;
}

async function checkDatabase() {
  const res = await apiFetch("/api/admin/cleanup");
  if (!res.ok) return showCleanupMessage(await apiError(res), "danger");
  const report = await res.json();

  document.getElementById("cleanupStart").classList.add("d-none");
  document.getElementById("cleanupResult").classList.remove("d-none");
  showDuplicates(report.duplicates, report.duplicate_seconds);
  showWithoutVehicle(report.unassigned);
}

document.getElementById("btnCheck").addEventListener("click", () => {
  document.getElementById("cleanupAlert").classList.add("d-none");
  checkDatabase();
});

document.getElementById("btnDeleteDuplicates").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".duplicate-group:checked")]
    .flatMap(c => c.dataset.ids.split(",").map(Number));
  if (ids.length === 0) return showCleanupMessage(t("admin.cleanup.noGroup"), "warning");
  if (!confirm(`${t("admin.cleanup.confirmDeleteDuplicates", { count: ids.length })} ${t("admin.cleanup.auditHint")}`)) return;

  const res = await apiFetch("/api/admin/cleanup/duplicates", { method: "POST", body: { ids } });
  if (!res.ok) return showCleanupMessage(await apiError(res), "danger");
  const { removed: removed, rejected: rejected } = await res.json();
  showCleanupMessage(t("admin.cleanup.duplicatesDeleted", { count: Number(removed) }) +
    (rejected.length ? t("admin.cleanup.skipped", { count: rejected.length }) : "."), "success");
  checkDatabase();
});

document.getElementById("unassignedList").addEventListener("click", async e => {
  const assignBtn = e.target.closest(".unassigned-assign");
  const deleteBtn = e.target.closest(".unassigned-delete");
  const btn = assignBtn ?? deleteBtn;
  if (!btn) return;

  const user_id = Number(btn.dataset.user);
  let body;
  if (assignBtn) {
    const select = document.querySelector(`.unassigned-target[data-user="${user_id}"]`);
    const name   = select.selectedOptions[0].textContent;
    if (!confirm(t("admin.cleanup.confirmAssign", { count: Number(btn.dataset.count), name: btn.dataset.name, vehicle: name }))) return;
    body = { user_id, action: "assign", vehicle_id: Number(select.value) };
  } else {
    if (!confirm(`${t("admin.cleanup.confirmDeleteUnassigned", { count: Number(btn.dataset.count), name: btn.dataset.name })}\n` +
                 t("admin.cleanup.auditHint"))) return;
    body = { user_id, action: "delete" };
  }

  const res = await apiFetch("/api/admin/cleanup/unassigned", { method: "POST", body });
  if (!res.ok) return showCleanupMessage(await apiError(res), "danger");
  const { count: count } = await res.json();
  showCleanupMessage(t(assignBtn ? "admin.cleanup.assigned" : "admin.cleanup.deleted", { count: Number(count) }), "success");
  checkDatabase();
});
