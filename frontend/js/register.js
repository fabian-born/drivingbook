// js/register.js
document.getElementById("registerBtn").addEventListener("click", async () => {
  const errorBox        = document.getElementById("regError");
  const username        = document.getElementById("username").value.trim();
  const password        = document.getElementById("password").value;
  const passwordConfirm = document.getElementById("passwordConfirm").value;
  const vehicleName     = document.getElementById("vehicleName").value.trim();

  errorBox.classList.add("d-none");

  // Client-seitige Validierung
  if (!username || !password) {
    errorBox.innerText = "Benutzername und Passwort sind Pflichtfelder.";
    errorBox.classList.remove("d-none");
    return;
  }
  if (password.length < 8) {
    errorBox.innerText = "Passwort muss mindestens 8 Zeichen haben.";
    errorBox.classList.remove("d-none");
    return;
  }
  if (password !== passwordConfirm) {
    errorBox.innerText = "Passwörter stimmen nicht überein.";
    errorBox.classList.remove("d-none");
    return;
  }

  const btn = document.getElementById("registerBtn");
  btn.disabled    = true;
  btn.textContent = "Wird erstellt …";

  try {
    const res = await apiFetch("/api/register", {
      method: "POST",
      body:   { username, password, vehicleName },
    });

    const data = await res.json();

    if (!res.ok) {
      errorBox.innerText = data.error || "Registrierung fehlgeschlagen.";
      errorBox.classList.remove("d-none");
      return;
    }

    // JWT speichern → User direkt eingeloggt
    localStorage.setItem("authToken", data.token);

    // Erfolgsansicht mit Token
    document.getElementById("viewForm").classList.add("d-none");
    document.getElementById("viewSuccess").classList.remove("d-none");
    document.getElementById("tokenDisplay").value   = data.default_token;
    document.getElementById("vehicleDisplay").value = data.vehicle?.name || "Fahrzeug 1";

  } catch (err) {
    errorBox.innerText = "Netzwerkfehler – bitte erneut versuchen.";
    errorBox.classList.remove("d-none");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Registrieren";
  }
});

// Token in Zwischenablage kopieren
document.getElementById("copyTokenBtn")?.addEventListener("click", () => {
  const input = document.getElementById("tokenDisplay");
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById("copyTokenBtn");
    btn.textContent = "✅";
    setTimeout(() => (btn.textContent = "📋"), 2000);
  });
});
