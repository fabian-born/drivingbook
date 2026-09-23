const form = document.getElementById("loginForm");
const errorBox = document.getElementById("loginError");

// Weiterleitung von apiFetch nach abgelaufener Anmeldung
if (new URLSearchParams(location.search).has("expired")) {
  errorBox.innerText = "Deine Sitzung ist abgelaufen – bitte erneut anmelden.";
  errorBox.className = "alert alert-warning";
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  errorBox.className = "alert alert-danger d-none";

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await apiFetch("/api/login", { method: "POST", body: { username, password } });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      errorBox.innerText = `❌ ${data.error || "Zu viele Anmeldeversuche – bitte später erneut versuchen"}`;
      errorBox.classList.remove("d-none");
      return;
    }

    if (!res.ok) {
      throw new Error("Login fehlgeschlagen");
    }

    const data = await res.json();

    // Token speichern
    localStorage.setItem("authToken", data.token);

    // Weiterleitung zum Dashboard
    window.location.href = "index.html";

  } catch (err) {
    errorBox.innerText = "❌ Benutzername oder Passwort falsch";
    errorBox.classList.remove("d-none");
  }
});

