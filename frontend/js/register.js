// js/register.js
document.getElementById("registerBtn").addEventListener("click", async () => {
  const errorBox        = document.getElementById("regError");
  const username        = document.getElementById("username").value.trim().toLowerCase();
  const password        = document.getElementById("password").value;
  const passwordConfirm = document.getElementById("passwordConfirm").value;
  const vehicleName     = document.getElementById("vehicleName").value.trim();

  errorBox.classList.add("d-none");

  // Client-side validation
  if (!username || !password) {
    errorBox.innerText = t("register.required");
    errorBox.classList.remove("d-none");
    return;
  }
  if (password.length < 8) {
    errorBox.innerText = t("register.tooShort");
    errorBox.classList.remove("d-none");
    return;
  }
  if (password !== passwordConfirm) {
    errorBox.innerText = t("register.mismatch");
    errorBox.classList.remove("d-none");
    return;
  }

  const btn = document.getElementById("registerBtn");
  btn.disabled    = true;
  btn.textContent = t("register.creating");

  try {
    const res = await apiFetch("/api/register", {
      method: "POST",
      body:   { username, password, vehicleName },
    });

    const data = await res.json();

    if (!res.ok) {
      errorBox.innerText = data.error || t("register.failed");
      errorBox.classList.remove("d-none");
      return;
    }

    // Store the JWT → user is logged in right away
    localStorage.setItem("authToken", data.token);
    localStorage.removeItem("aktivesFahrzeug");
    localStorage.removeItem("fahrzeuge");

    // Success view with token
    document.getElementById("viewForm").classList.add("d-none");
    document.getElementById("viewSuccess").classList.remove("d-none");
    document.getElementById("tokenDisplay").value   = data.default_token;
    document.getElementById("vehicleDisplay").value = data.vehicle?.name || t("register.vehicleDefault");

  } catch (err) {
    errorBox.innerText = t("register.networkError");
    errorBox.classList.remove("d-none");
  } finally {
    btn.disabled    = false;
    btn.textContent = t("register.submit");
  }
});

// Copy the token to the clipboard
document.getElementById("copyTokenBtn")?.addEventListener("click", () => {
  const input = document.getElementById("tokenDisplay");
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById("copyTokenBtn");
    btn.textContent = "✅";
    setTimeout(() => (btn.textContent = "📋"), 2000);
  });
});
