const form = document.getElementById("loginForm");

// Language choice before login (this device only)
languageSelect(document.getElementById("languageSelect"), newValue => { i18n.set(newValue); location.reload(); });
const errorBox = document.getElementById("loginError");

// Redirect from apiFetch after the session expired
if (new URLSearchParams(location.search).has("expired")) {
  errorBox.innerText = t("login.expired");
  errorBox.className = "alert alert-warning";
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  errorBox.className = "alert alert-danger d-none";

  const username = document.getElementById("username").value.trim().toLowerCase();
  const password = document.getElementById("password").value;

  try {
    const res = await apiFetch("/api/login", { method: "POST", body: { username, password } });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      errorBox.innerText = `❌ ${data.error || t("login.tooMany")}`;
      errorBox.classList.remove("d-none");
      return;
    }

    if (!res.ok) {
      throw new Error("Login fehlgeschlagen");
    }

    const data = await res.json();

    // Store the token; the vehicle choice of an earlier login no longer applies
    localStorage.setItem("authToken", data.token);
    localStorage.removeItem("aktivesFahrzeug");
    localStorage.removeItem("fahrzeuge");
    // The language chosen in the profile applies on this device (otherwise the previous choice stays)
    if (data.user?.language) i18n.set(data.user.language);

  } catch (err) {
    errorBox.innerText = `❌ ${t("login.failed")}`;
    errorBox.classList.remove("d-none");
    return;
  }

  await promptVehicleChoice();
});

// With several vehicles let the user pick one first, otherwise go straight to the dashboard
async function promptVehicleChoice() {
  let vehicles = [];
  try {
    const res = await apiFetch("/api/vehicles");
    if (res.ok) vehicles = await res.json();
  } catch { /* choose later via the navigation instead */ }

  if (vehicles.length <= 1) {
    window.location.href = "index.html";
    return;
  }

  const listEl = document.getElementById("vehicleList");
  listEl.innerHTML = vehicles.map(v => `
    <button type="button" class="btn ${v.is_default ? "btn-primary" : "btn-outline-primary"}" data-code="${escapeHtml(v.code)}">
      🚗 ${escapeHtml(v.name)}${v.is_default ? t("login.default") : ""}
    </button>`).join("");
  listEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-code]");
    if (!btn) return;
    localStorage.setItem("aktivesFahrzeug", btn.dataset.code);
    window.location.href = "index.html";
  });

  form.classList.add("d-none");
  document.getElementById("vehicleChoice").classList.remove("d-none");
}

