// js/profile.js
document.addEventListener("DOMContentLoaded", async () => {

  // ──────────────────────────────────────────────────────────
  // Load profile
  // ──────────────────────────────────────────────────────────
  async function ladeProfil() {
    try {
      const res  = await apiFetch(`/api/profile`);
      const data = await res.json();

      document.getElementById("profileUsername").textContent =
        data.user.username;
      document.getElementById("profileRole").textContent =
        data.user.role === "admin" ? t("profile.roleAdmin") : t("profile.roleUser");
      document.getElementById("profileCreated").textContent =
        new Date(data.user.created_at).toLocaleString(i18n.locale);
      document.getElementById("profileCountry").textContent =
        landName(data.user.country);
      sprachAuswahl(document.getElementById("profileLanguage"), speichereSprache, data.user.language);

      renderTokenTabelle(data.tokens);

    } catch (err) {
      console.error("Profil-Ladefehler:", err);
    }
  }

  // Save language in the profile (applies on all devices) and apply it immediately
  async function speichereSprache(language) {
    const res = await apiFetch("/api/profile", { method: "PATCH", body: { language } });
    if (!res.ok) return alert(await apiError(res, t("profile.languageSaveFailed")));
    i18n.setze(language);
    location.reload();
  }

  // ──────────────────────────────────────────────────────────
  // Render token table
  // ──────────────────────────────────────────────────────────
  function renderTokenTabelle(tokens) {
    const tbody = document.getElementById("tokenTabelle");
    if (!tokens.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-muted p-3">${t("profile.tokens.none")}</td></tr>`;
      return;
    }
    tbody.innerHTML = tokens.map(tok => `
      <tr>
        <td>${escapeHtml(tok.label)}</td>
        <td>${tok.is_default
          ? `<span class="badge bg-success">${t("profile.tokens.default")}</span>`
          : `<span class="badge bg-secondary">${t("profile.tokens.no")}</span>`}</td>
        <td class="text-muted small d-none d-sm-table-cell">${new Date(tok.created_at).toLocaleString(i18n.locale)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger delete-token-btn" data-id="${tok.id}"
            title="${t("profile.tokens.delete")}">
            <span class="mdi mdi-delete"></span>
          </button>
        </td>
      </tr>`).join("");
  }

  // ──────────────────────────────────────────────────────────
  // Change password
  // ──────────────────────────────────────────────────────────
  document.getElementById("pwSaveBtn").addEventListener("click", async () => {
    const alert       = document.getElementById("pwAlert");
    const current     = document.getElementById("pwCurrent").value;
    const newPw       = document.getElementById("pwNew").value;
    const newPwConfirm = document.getElementById("pwNewConfirm").value;

    alert.className = "alert d-none";

    if (!current || !newPw) {
      alert.className = "alert alert-danger";
      alert.textContent = t("profile.password.fillAll");
      return;
    }
    if (newPw.length < 8) {
      alert.className = "alert alert-danger";
      alert.textContent = t("profile.password.tooShort");
      return;
    }
    if (newPw !== newPwConfirm) {
      alert.className = "alert alert-danger";
      alert.textContent = t("register.mismatch");
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
        alert.textContent = data.error || t("profile.password.failed");
      } else {
        alert.className   = "alert alert-success";
        alert.textContent = t("profile.password.changed");
        document.getElementById("pwCurrent").value    = "";
        document.getElementById("pwNew").value        = "";
        document.getElementById("pwNewConfirm").value = "";
      }
    } catch {
      alert.className   = "alert alert-danger";
      alert.textContent = t("profile.networkError");
    }
  });

  // ──────────────────────────────────────────────────────────
  // New token – show/hide form
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

  // Create token
  document.getElementById("createTokenBtn").addEventListener("click", async () => {
    const label      = document.getElementById("tokenLabel").value.trim() || "API Token";
    const is_default = document.getElementById("tokenDefault").checked;

    try {
      const res  = await apiFetch(`/api/tokens`, {
        method: "POST",
        body: { label, is_default },
      });
      const data = await res.json();

      if (!res.ok) { alert(data.error || t("profile.tokens.error")); return; }

      // Show token once
      document.getElementById("newTokenForm").classList.add("d-none");
      document.getElementById("newTokenResult").classList.remove("d-none");
      document.getElementById("newTokenValue").value = data.token;

      // Reload table
      await ladeProfil();

    } catch { alert(t("profile.networkError")); }
  });

  // Copy new token
  document.getElementById("copyNewTokenBtn").addEventListener("click", () => {
    const val = document.getElementById("newTokenValue").value;
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById("copyNewTokenBtn");
      btn.textContent = "✅";
      setTimeout(() => (btn.textContent = "📋"), 2000);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Delete token (event delegation)
  // ──────────────────────────────────────────────────────────
  document.getElementById("tokenTabelle").addEventListener("click", async e => {
    const btn = e.target.closest(".delete-token-btn");
    if (!btn) return;
    if (!confirm(t("profile.tokens.confirmDelete"))) return;

    try {
      const res = await apiFetch(`/api/tokens/${btn.dataset.id}`, {
        method: "DELETE",
      });
      if (res.ok) await ladeProfil();
      else alert(t("profile.tokens.deleteFailed"));
    } catch { alert(t("profile.networkError")); }
  });

  // ──────────────────────────────────────────────────────────
  // Backup
  // ──────────────────────────────────────────────────────────
  const sicherungAlert = (text, typ) => {
    const box = document.getElementById("sicherungAlert");
    box.className   = `alert alert-${typ}`;
    box.textContent = text;
  };

  async function zeigeSicherungsStatus() {
    const status = await ladeSicherungsStatus();
    if (!status) return;
    document.getElementById("sicherungTabelle").innerHTML = status.vehicles.length === 0
      ? `<tr><td colspan="3" class="text-muted">${t("profile.backup.noVehicles")}</td></tr>`
      : status.vehicles.map(v => `
        <tr class="${v.remind ? "table-warning" : ""}">
          <td>${escapeHtml(v.name)}</td>
          <td>${escapeHtml(datumKurz(v.last_backup_at))}${v.remind ? ` <span class="badge text-bg-warning">${t("profile.backup.due")}</span>` : ""}</td>
          <td class="text-end">${v.changes}</td>
        </tr>`).join("");
  }

  document.getElementById("sichernBtn").addEventListener("click", async () => {
    await sichereAlles();
    await zeigeSicherungsStatus();
  });

  document.getElementById("wiederherstellenBtn").addEventListener("click", async () => {
    const datei = document.getElementById("wiederherstellenDatei").files[0];
    if (!datei) return sicherungAlert(t("profile.backup.chooseFile"), "warning");
    try {
      const ergebnis = await stelleSicherungWiederHer(datei);
      if (!ergebnis) return;
      sicherungAlert(`${t("profile.backup.restored")}\n${ergebnis.text}`, "success");
      await zeigeSicherungsStatus();
    } catch (err) {
      sicherungAlert(err.message, "danger");
    }
  });

  // ── Init ──────────────────────────────────────────────────
  await Promise.all([ladeProfil(), zeigeSicherungsStatus()]);
});
