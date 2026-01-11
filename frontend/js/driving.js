// js/driving.js
document.getElementById("fahrtForm")?.addEventListener("submit", async e => {
  e.preventDefault();

  const data = {
    kmstand: document.getElementById("kmstand").value,
    ziel: document.getElementById("ziel").value,
    fahrtart: document.querySelector("input[name='fahrtart']:checked").value,
    timestamp: new Date().toISOString()
  };

  const res = await fetch(`${API_BASE_URL}/api/fahrt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  if (res.ok) {
    alert("Fahrt gespeichert");
    e.target.reset();
  } else {
    alert("Fehler beim Speichern");
  }
});