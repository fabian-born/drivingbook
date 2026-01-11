// js/dashboard.js
const aktuellesJahr = new Date().getFullYear();

async function ladeDashboard() {
    let monatsKm = {};
    let gesamtKm = 0;
    let monatsTabelle = [];
    let prevEndKm = 56510;
    let totalPrivat = 0;
    let totalGeschaeft = 0;

  let letzterEndKm = null;

  for (let m = 1; m <= 12; m++) {
    const month = `${aktuellesJahr}-${String(m).padStart(2, "0")}`;

      try {
        const res = await fetch(`${API_BASE_URL}/api/export/json?month=${month}`);
        if (!res.ok) continue;
        const fahrten = await res.json();
        if (fahrten.length === 0) continue;

        // Start KM = End KM des Vormonats
        const startKm = prevEndKm;
        const endKm = parseInt(fahrten[fahrten.length - 1].kmstand);
        const diff = endKm - startKm;

        prevEndKm = endKm;

        monatsKm[month] = diff;
        gesamtKm += diff;
        // monatsTabelle.push({ month, startKm, endKm, diff });

        // Privat / Geschäftlich korrekt berechnen
        let privat = 0, geschaeft = 0;
        for (let i = 0; i < fahrten.length; i++) {
          let kmDelta;
          if (i === 0) {
            kmDelta = parseInt(fahrten[0].kmstand) - startKm;
          } else {
            kmDelta = parseInt(fahrten[i].kmstand) - parseInt(fahrten[i-1].kmstand);
          }

          if (fahrten[i].fahrtart.toLowerCase() === "privat") privat += kmDelta;
          else geschaeft += kmDelta;
        }
        monatsTabelle.push({ month, startKm, endKm, diff, privat, geschaeft });
        totalPrivat += privat;
        totalGeschaeft += geschaeft;
    } catch (e) {
      console.warn("Kein Monat:", month);
    }
  }

    // Dashboard Boxen
    document.getElementById("kmProMonat").innerText =
      (Object.values(monatsKm).reduce((a,b)=>a+b,0) / Object.keys(monatsKm).length || 0).toFixed(1);

    document.getElementById("splitKm").innerText =
      `Privat: ${totalPrivat} (${((totalPrivat/gesamtKm) * 100).toFixed(2)} %) km 
       Geschäftlich: ${totalGeschaeft} (${((totalGeschaeft/gesamtKm) * 100).toFixed(2)} %) km`;

    document.getElementById("kmGesamtJahr").innerText = gesamtKm;

    // Monats-Tabelle
    const tbody = document.getElementById("monatsTabelle");
    tbody.innerHTML = "";
    monatsTabelle.forEach(row => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.month}</td>
        <td>${row.startKm}</td>
        <td>${row.endKm}</td>
        <td>${row.diff}</td>
        <td>${row.privat}</td>
        <td>${row.geschaeft}</td>
        <td>${row.diff ? ((row.privat / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
        <td>${row.diff ? ((row.geschaeft / row.diff) * 100).toFixed(1) + "%" : "-"}</td>
      `;
      tbody.appendChild(tr);
    });

  new Chart(document.getElementById("kmChart"), {
    type: "line",
    data: {
      labels: Object.keys(monatsKm),
      datasets: [{
        label: "Gefahrene KM",
        data: Object.values(monatsKm),
        borderWidth: 2,
        fill: true,
        tension: 0.3
      }]
    }
  });
}

ladeDashboard();
