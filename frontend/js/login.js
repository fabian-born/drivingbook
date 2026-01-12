const form = document.getElementById("loginForm");
const errorBox = document.getElementById("loginError");

form.addEventListener("submit", async e => {
  e.preventDefault();
  errorBox.classList.add("d-none");

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const res = await fetch(`${API_BASE_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

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

