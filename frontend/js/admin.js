// js/admin.js
const authHeaders = () => ({
  "Content-Type":  "application/json",
  "Authorization": `Bearer ${localStorage.getItem("authToken")}`
});

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
  const res = await fetch(`${API_BASE_URL}/api/users`, { headers: authHeaders() });

  if (res.status === 403) {
    document.getElementById("adminPanel").classList.add("d-none");
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
  const res  = await fetch(`${API_BASE_URL}/api/users`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ username, password, role })
  });
  const data = await res.json();

  if (!res.ok) {
    zeigeAlert(data.error || "Fehler beim Anlegen.", "danger", "userModalAlert");
    return;
  }

  // Fahrzeug anlegen (mit dem neuen User-Token geht das nicht direkt,
  // daher rufen wir den neuen /api/admin/users/:id/setup Endpoint auf)
  if (vehicleName) {
    await fetch(`${API_BASE_URL}/api/admin/users/${data.id}/vehicle`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: vehicleName })
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
