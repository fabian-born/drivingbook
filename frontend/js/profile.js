// js/profile.js
document.addEventListener("DOMContentLoaded", async () => {

  // ──────────────────────────────────────────────────────────
  // Profil laden
  // ──────────────────────────────────────────────────────────
  async function ladeProfil() {
    try {
      const res  = await apiFetch(`/api/profile`);
      const data = await res.json();

      document.getElementById("profileUsername").textContent =
        data.user.username;
      document.getElementById("profileRole").textContent =
        data.user.role === "admin" ? "👑 Administrator" : "👤 Benutzer";
      document.getElementById("profileCreated").textContent =
        new Date(data.user.created_at).toLocaleString("de-DE");

      renderTokenTabelle(data.tokens);
      renderVehicleTabelle(data.vehicles);

    } catch (err) {
      console.error("Profil-Ladefehler:", err);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Token-Tabelle rendern
  // ──────────────────────────────────────────────────────────
  function renderTokenTabelle(tokens) {
    const tbody = document.getElementById("tokenTabelle");
    if (!tokens.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-muted p-3">Keine Tokens vorhanden.</td></tr>`;
      return;
    }
    tbody.innerHTML = tokens.map(t => `
      <tr>
        <td>${escapeHtml(t.label)}</td>
        <td>${t.is_default
          ? '<span class="badge bg-success">Standard</span>'
          : '<span class="badge bg-secondary">Nein</span>'}</td>
        <td class="text-muted small">${new Date(t.created_at).toLocaleString("de-DE")}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger delete-token-btn" data-id="${t.id}"
            title="Token löschen">
            <span class="mdi mdi-delete"></span>
          </button>
        </td>
      </tr>`).join("");
  }

  // ──────────────────────────────────────────────────────────
  // Fahrzeug-Tabelle rendern
  // ──────────────────────────────────────────────────────────
  function renderVehicleTabelle(vehicles) {
    const tbody = document.getElementById("vehicleTabelle");
    if (!vehicles.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-muted p-3">Keine Fahrzeuge vorhanden.</td></tr>`;
      return;
    }
    tbody.innerHTML = vehicles.map(v => `
      <tr>
        <td>${escapeHtml(v.name)}</td>
        <td class="text-muted small">${new Date(v.created_at).toLocaleString("de-DE")}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger delete-vehicle-btn" data-id="${v.id}"
            title="Fahrzeug löschen">
            <span class="mdi mdi-delete"></span>
          </button>
        </td>
      </tr>`).join("");
  }

  // ──────────────────────────────────────────────────────────
  // Passwort ändern
  // ──────────────────────────────────────────────────────────
  document.getElementById("pwSaveBtn").addEventListener("click", async () => {
    const alert       = document.getElementById("pwAlert");
    const current     = document.getElementById("pwCurrent").value;
    const newPw       = document.getElementById("pwNew").value;
    const newPwConfirm = document.getElementById("pwNewConfirm").value;

    alert.className = "alert d-none";

    if (!current || !newPw) {
      alert.className = "alert alert-danger";
      alert.textContent = "Bitte alle Felder ausfüllen.";
      return;
    }
    if (newPw.length < 8) {
      alert.className = "alert alert-danger";
      alert.textContent = "Neues Passwort muss mindestens 8 Zeichen haben.";
      return;
    }
    if (newPw !== newPwConfirm) {
      alert.className = "alert alert-danger";
      alert.textContent = "Passwörter stimmen nicht überein.";
      return;
    }

    try {
      const res  = await apiFetch(`/api/users/change-password`, {
        method: "POST",
        body: { currentPassword: current, newPassword: newPw },
      });
      const data = await res.json();

      if (!res.ok) {
        alert.className   = "alert alert-danger";
        alert.textContent = data.error || "Fehler beim Ändern.";
      } else {
        alert.className   = "alert alert-success";
        alert.textContent = "✅ Passwort erfolgreich geändert.";
        document.getElementById("pwCurrent").value    = "";
        document.getElementById("pwNew").value        = "";
        document.getElementById("pwNewConfirm").value = "";
      }
    } catch {
      alert.className   = "alert alert-danger";
      alert.textContent = "Netzwerkfehler.";
    }
  });

  // ──────────────────────────────────────────────────────────
  // Neuer Token – Formular ein-/ausblenden
  // ──────────────────────────────────────────────────────────
  document.getElementById("newTokenBtn").addEventListener("click", () => {
    document.getElementById("newTokenForm").classList.remove("d-none");
    document.getElementById("newTokenResult").classList.add("d-none");
    document.getElementById("newTokenBtn").classList.add("d-none");
  });

  document.getElementById("cancelTokenBtn").addEventListener("click", () => {
    document.getElementById("newTokenForm").classList.add("d-none");
    document.getElementById("newTokenBtn").classList.remove("d-none");
  });

  // Token erstellen
  document.getElementById("createTokenBtn").addEventListener("click", async () => {
    const label      = document.getElementById("tokenLabel").value.trim() || "API Token";
    const is_default = document.getElementById("tokenDefault").checked;

    try {
      const res  = await apiFetch(`/api/tokens`, {
        method: "POST",
        body: { label, is_default },
      });
      const data = await res.json();

      if (!res.ok) { alert(data.error || "Fehler"); return; }

      // Token einmalig anzeigen
      document.getElementById("newTokenForm").classList.add("d-none");
      document.getElementById("newTokenResult").classList.remove("d-none");
      document.getElementById("newTokenValue").value = data.token;

      // Tabelle neu laden
      await ladeProfil();

    } catch { alert("Netzwerkfehler."); }
  });

  // Neuen Token kopieren
  document.getElementById("copyNewTokenBtn").addEventListener("click", () => {
    const val = document.getElementById("newTokenValue").value;
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById("copyNewTokenBtn");
      btn.textContent = "✅";
      setTimeout(() => (btn.textContent = "📋"), 2000);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Token löschen (Event-Delegation)
  // ──────────────────────────────────────────────────────────
  document.getElementById("tokenTabelle").addEventListener("click", async e => {
    const btn = e.target.closest(".delete-token-btn");
    if (!btn) return;
    if (!confirm("Token wirklich löschen?")) return;

    try {
      const res = await apiFetch(`/api/tokens/${btn.dataset.id}`, {
        method: "DELETE",
      });
      if (res.ok) await ladeProfil();
      else alert("Fehler beim Löschen.");
    } catch { alert("Netzwerkfehler."); }
  });

  // ──────────────────────────────────────────────────────────
  // Fahrzeug anlegen
  // ──────────────────────────────────────────────────────────
  document.getElementById("newVehicleBtn").addEventListener("click", () => {
    document.getElementById("newVehicleForm").classList.remove("d-none");
    document.getElementById("newVehicleBtn").classList.add("d-none");
  });

  document.getElementById("cancelVehicleBtn").addEventListener("click", () => {
    document.getElementById("newVehicleForm").classList.add("d-none");
    document.getElementById("newVehicleBtn").classList.remove("d-none");
  });

  document.getElementById("createVehicleBtn").addEventListener("click", async () => {
    const name = document.getElementById("vehicleNameInput").value.trim();
    if (!name) { alert("Bitte einen Namen eingeben."); return; }

    try {
      const res = await apiFetch(`/api/vehicles`, {
        method: "POST",
        body: { name },
      });
      if (res.ok) {
        document.getElementById("vehicleNameInput").value = "";
        document.getElementById("newVehicleForm").classList.add("d-none");
        document.getElementById("newVehicleBtn").classList.remove("d-none");
        await ladeProfil();
      } else {
        const d = await res.json();
        alert(d.error || "Fehler beim Anlegen.");
      }
    } catch { alert("Netzwerkfehler."); }
  });

  // ──────────────────────────────────────────────────────────
  // Fahrzeug löschen (Event-Delegation)
  // ──────────────────────────────────────────────────────────
  document.getElementById("vehicleTabelle").addEventListener("click", async e => {
    const btn = e.target.closest(".delete-vehicle-btn");
    if (!btn) return;
    if (!confirm("Fahrzeug wirklich löschen? Fahrten bleiben erhalten.")) return;

    try {
      const res = await apiFetch(`/api/vehicles/${btn.dataset.id}`, {
        method: "DELETE",
      });
      if (res.ok) await ladeProfil();
      else alert("Fehler beim Löschen.");
    } catch { alert("Netzwerkfehler."); }
  });

  // ── Init ──────────────────────────────────────────────────
  await ladeProfil();
});
