const form = document.getElementById("loginForm");

// Sprachwahl vor dem Login (nur für dieses Gerät)
sprachAuswahl(document.getElementById("spracheWahl"), neu => { i18n.setze(neu); location.reload(); });
const errorBox = document.getElementById("loginError");

// Weiterleitung von apiFetch nach abgelaufener Anmeldung
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

    // Token speichern; Fahrzeugauswahl eines früheren Logins gilt nicht mehr
    localStorage.setItem("authToken", data.token);
    localStorage.removeItem("aktivesFahrzeug");
    localStorage.removeItem("fahrzeuge");
    // Im Profil gewählte Sprache gilt auf diesem Gerät (sonst bleibt die bisherige Wahl)
    if (data.user?.language) i18n.setze(data.user.language);

  } catch (err) {
    errorBox.innerText = `❌ ${t("login.failed")}`;
    errorBox.classList.remove("d-none");
    return;
  }

  await fahrzeugWaehlen();
});

// Bei mehreren Fahrzeugen erst das Fahrzeug wählen lassen, sonst direkt zum Dashboard
async function fahrzeugWaehlen() {
  let vehicles = [];
  try {
    const res = await apiFetch("/api/vehicles");
    if (res.ok) vehicles = await res.json();
  } catch { /* Auswahl dann später über die Navigation */ }

  if (vehicles.length <= 1) {
    window.location.href = "index.html";
    return;
  }

  const liste = document.getElementById("fahrzeugListe");
  liste.innerHTML = vehicles.map(v => `
    <button type="button" class="btn ${v.is_default ? "btn-primary" : "btn-outline-primary"}" data-code="${escapeHtml(v.code)}">
      🚗 ${escapeHtml(v.name)}${v.is_default ? t("login.default") : ""}
    </button>`).join("");
  liste.addEventListener("click", e => {
    const btn = e.target.closest("button[data-code]");
    if (!btn) return;
    localStorage.setItem("aktivesFahrzeug", btn.dataset.code);
    window.location.href = "index.html";
  });

  form.classList.add("d-none");
  document.getElementById("fahrzeugWahl").classList.remove("d-none");
}

