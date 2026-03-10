  // const API_BASE_URL = "https://fahrtenbuch-backend.home.fabianborn.net"; // Backend Container (ohne Trailing Slash)

  function getLocation() {
    if (!navigator.geolocation) return alert("Geolocation wird nicht unterstützt.");
    navigator.geolocation.getCurrentPosition(showPosition, showError);
  }

  function showPosition(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`)
      .then(res => res.json())
      .then(data => {
        const addr = data.address || {};
        const strasse = addr.road || "";
        const hausnr = addr.house_number || "";
        const plz = addr.postcode || "";
        const ort = addr.city || addr.town || addr.village || "";
        document.getElementById("ziel").value = `${strasse} ${hausnr}, ${plz} ${ort}`.trim();
      })
      .catch(err => console.error("Location Error:", err));
  }

  function showError(error) {
    const msgs = ["Zugriff verweigert", "Position nicht verfügbar", "Zeitüberschreitung"];
    alert(msgs[error.code - 1] || "Unbekannter Fehler");
  }

  function addFahrt() {
    const kmstand = document.getElementById("kmstand").value;
    const ziel = document.getElementById("ziel").value;
    const fahrtart = document.querySelector('input[name="fahrtart"]:checked')?.value;
    const timestamp = new Date().toISOString();

    if (!kmstand || !ziel || !fahrtart) {
      return alert("Bitte alle Felder ausfüllen!");
    }

    // Die Fetch-Kette: KEINE Semikolons zwischen den Gliedern!
    fetch(`${API_BASE_URL}/api/fahrt`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${localStorage.getItem("authToken")}`
      },
      body: JSON.stringify({ kmstand, ziel, fahrtart, timestamp })
    })
    .then(res => {
      if (!res.ok) throw new Error("Server antwortet mit Fehler " + res.status);
      return res.json();
    })
    .then(data => {
      alert("✅ Fahrt erfolgreich gespeichert!");
      // Formular leeren
      document.getElementById("kmstand").value = "";
      document.getElementById("ziel").value = "";
    })
    .catch(err => {
      console.error("Fehler beim Speichern:", err);
      alert("Fehler beim Speichern. Prüfen Sie die Konsole (F12).");
    });
  }

  function downloadCSV() {
    const month = new Date().toISOString().slice(0,7);
    window.location.href = `${API_BASE_URL}/api/export/csv?month=${month}`;
  }

  function downloadJSON() {
    const month = new Date().toISOString().slice(0,7);
    window.location.href = `${API_BASE_URL}/api/export/json?month=${month}`;
  }
