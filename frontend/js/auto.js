// js/auto.js
// Auto-Info: Daten und Kennzahlen des aktiven Fahrzeugs, Vergleich
// 1-%-Regel ↔ Fahrtenbuch, Verwaltung aller Fahrzeuge.

const $ = id => document.getElementById(id);

const euro    = n => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const km      = n => `${n.toLocaleString("de-DE")} km`;
const prozent = (anteil, stellen = 1) =>
  `${(anteil * 100).toLocaleString("de-DE", { maximumFractionDigits: stellen })} %`;
const datum   = d => new Date(d).toLocaleDateString("de-DE");

// Leere Zahlenfelder → null
const zahl = id => ($(id).value === "" ? null : Number($(id).value));

function zeigeAlert(id, text, typ) {
  const box = $(id);
  box.className   = `alert alert-${typ}`;
  box.textContent = text;
  if (typ === "success") setTimeout(() => box.classList.add("d-none"), 3000);
}

// ── Jahr ─────────────────────────────────────────────────────

function fuelleJahre() {
  const aktuell = new Date().getFullYear();
  for (let j = aktuell; j >= START_JAHR; j--) {
    $("jahrSelect").insertAdjacentHTML("beforeend", `<option value="${j}">${j}</option>`);
  }
}

// ── Aktives Fahrzeug ─────────────────────────────────────────

async function ladeInfo() {
  if (!aktivesFahrzeug) return;
  const jahr = $("jahrSelect").value;

  const res = await apiFetch(`/api/vehicles/${aktivesFahrzeug.id}/info?year=${jahr}`);
  if (!res.ok) return zeigeAlert("datenAlert", await apiError(res), "danger");
  const info = await res.json();

  zeigeFahrzeug(info.vehicle);
  zeigeKennzahlen(info);
  zeigeKosten(info.kosten);
  zeigeVergleich(info);
}

// ── Prüfung ──────────────────────────────────────────────────

const AMPEL  = {
  gruen: { text: "Alles in Ordnung", farbe: "success" },
  gelb:  { text: "Bitte prüfen",     farbe: "warning" },
  rot:   { text: "Fehler gefunden",  farbe: "danger" },
};
const STUFE = {
  fehler:  { icon: "mdi-close-circle",       farbe: "text-danger" },
  warnung: { icon: "mdi-alert",              farbe: "text-warning" },
  hinweis: { icon: "mdi-information-outline", farbe: "text-secondary" },
};

async function ladePruefung() {
  if (!aktivesFahrzeug) return;
  const res = await apiFetch(`/api/vehicles/${aktivesFahrzeug.id}/pruefung?year=${$("jahrSelect").value}`);
  if (!res.ok) return;
  const { ampel, befunde } = await res.json();

  $("pruefAmpel").className   = `badge text-bg-${AMPEL[ampel].farbe}`;
  $("pruefAmpel").textContent = AMPEL[ampel].text;

  $("pruefListe").innerHTML = befunde.length === 0
    ? `<li class="list-group-item text-success"><span class="mdi mdi-check-circle me-2"></span>Keine Auffälligkeiten gefunden.</li>`
    : befunde.map(b => `
        <li class="list-group-item d-flex gap-2">
          <span class="mdi ${STUFE[b.stufe].icon} ${STUFE[b.stufe].farbe}"></span>
          <div>
            ${b.timestamp ? `<div class="small text-muted">${escapeHtml(new Date(b.timestamp).toLocaleString("de-DE"))} · ${escapeHtml(km(b.kmstand))}</div>` : ""}
            ${escapeHtml(b.text)}
          </div>
        </li>`).join("");
}

function zeigeFahrzeug(v) {
  $("autoName").textContent = v.name;
  $("autoCode").textContent = v.code;
  $("autoKennzeichen").textContent = v.license_plate ?? "";
  $("autoKennzeichen").classList.toggle("d-none", !v.license_plate);

  $("fdName").value        = v.name;
  $("fdKennzeichen").value = v.license_plate ?? "";
  $("fdListenpreis").value = v.list_price ?? "";
  $("fdAntrieb").value     = v.drive_type;
}

function zeigeKennzahlen({ gesamt, jahr, year }) {
  $("kzKmAktuell").textContent = gesamt.km_aktuell != null ? km(gesamt.km_aktuell) : "–";
  $("kzKmJahr").textContent    = km(jahr.gesamt);
  const privat = jahr.privat + jahr.arbeitsweg;
  $("kzPrivat").textContent    = jahr.gesamt > 0
    ? `${km(privat)} (${prozent(privat / jahr.gesamt)})`
    : "–";
  $("kzFahrten").textContent   = jahr.fahrten.toLocaleString("de-DE");
  $("kzZeitraum").textContent  = gesamt.fahrten > 0
    ? `Insgesamt ${gesamt.fahrten.toLocaleString("de-DE")} Fahrten vom ${datum(gesamt.erste_fahrt)} bis ${datum(gesamt.letzte_fahrt)}.`
    : "Für dieses Fahrzeug sind noch keine Fahrten erfasst.";
  $("vgJahr").textContent = year;
}

function zeigeKosten(k) {
  $("kGesamt").value     = k?.total_costs ?? "";
  $("kAfa").value        = k?.depreciation || "";
  $("kArbeitsweg").value = k?.commute_km || "";
  $("kMonate").value     = k?.months ?? 12;
  $("kSteuersatz").value = k?.tax_rate ?? "";
}

function zeigeVergleich({ vehicle, kosten, jahr, vergleich: vg }) {
  const hinweis = $("vgHinweis");
  $("vgErgebnis").classList.toggle("d-none", !vg);

  if (!vg) {
    hinweis.textContent = vehicle.list_price == null
      ? "Trage oben den Bruttolistenpreis ein, dann kann der Vergleich berechnet werden."
      : "Trage die Kosten des Jahres ein, um beide Methoden zu vergleichen.";
    hinweis.classList.remove("d-none");
    return;
  }
  hinweis.classList.add("d-none");

  // 1-%-Regel
  const satz = `${vg.satz.toLocaleString("de-DE")} %`;
  $("vgPauschalSumme").textContent = euro(vg.pauschal.summe);
  $("vgPauschalDetail").innerHTML = [
    `${satz} × ${euro(vg.listenpreis)} × ${kosten.months} Monate = ${euro(vg.pauschal.privatnutzung)}`,
    vg.pauschal.arbeitsweg > 0 ? `+ Arbeitsweg ${kosten.commute_km.toLocaleString("de-DE")} km = ${euro(vg.pauschal.arbeitsweg)}` : "",
    vg.pauschal.gedeckelt ? `<strong>gedeckelt auf die Kosten von ${euro(vg.kosten_gesamt)}</strong>` : "",
  ].filter(Boolean).join("<br>");

  // Fahrtenbuch
  const fb = vg.fahrtenbuch;
  $("vgFahrtenbuchSumme").textContent = fb ? euro(fb.summe) : "–";
  $("vgFahrtenbuchDetail").textContent = fb
    ? `${prozent(fb.privat_anteil)} privat inkl. Arbeitsweg (${km(jahr.privat + jahr.arbeitsweg)} von ${km(jahr.gesamt)}) × Kosten ${euro(vg.kosten_gesamt)}`
    : "Noch keine gefahrenen Kilometer in diesem Jahr.";

  $("vgPauschal").classList.toggle("gewinner", vg.empfehlung === "pauschal");
  $("vgFahrtenbuch").classList.toggle("gewinner", vg.empfehlung === "fahrtenbuch");

  // Empfehlung
  const empfehlung = $("vgEmpfehlung");
  empfehlung.classList.toggle("d-none", !vg.empfehlung);
  if (vg.empfehlung) {
    const ersparnis = vg.steuer_ersparnis != null ? ` – geschätzt ${euro(vg.steuer_ersparnis)} weniger Steuern` : "";
    empfehlung.className = `alert mt-3 mb-3 alert-${vg.empfehlung === "fahrtenbuch" ? "success" : "warning"}`;
    empfehlung.innerHTML = vg.empfehlung === "fahrtenbuch"
      ? `<strong>Das Fahrtenbuch lohnt sich:</strong> ${euro(vg.differenz)} weniger zu versteuern als mit der 1-%-Regel${ersparnis}.`
      : `<strong>Die 1-%-Regel ist günstiger:</strong> ${euro(-vg.differenz)} weniger zu versteuern als mit dem Fahrtenbuch${ersparnis}.`;
  }

  // Grenze: bis zu welchem Privatanteil lohnt sich das Fahrtenbuch?
  const grenze = vg.break_even_anteil;
  $("vgBreakEvenBox").classList.toggle("d-none", grenze == null);
  if (grenze != null) {
    $("vgBreakEvenText").innerHTML = grenze >= 1
      ? "Das Fahrtenbuch ist bei jedem Privatanteil mindestens gleichauf."
      : `Das Fahrtenbuch lohnt sich bis zu einem Privatanteil von <strong>${prozent(grenze)}</strong>` +
        (fb ? ` – dein Anteil ${jahr.gesamt ? `liegt bei <strong>${prozent(fb.privat_anteil)}</strong>` : "ist noch offen"}.` : ".");
    $("vgBreakEvenZone").style.width = `${Math.min(grenze, 1) * 100}%`;
    const marker = $("vgPrivatMarker");
    marker.classList.toggle("d-none", !fb);
    if (fb) marker.style.left = `calc(${fb.privat_anteil * 100}% - 1px)`;
    $("vgBreakEvenBalken").setAttribute("aria-label",
      `Fahrtenbuch günstiger bis ${prozent(grenze)} Privatanteil` + (fb ? `, aktuell ${prozent(fb.privat_anteil)}` : ""));
  }
}

async function speichereDaten() {
  const body = {
    name:          $("fdName").value.trim(),
    license_plate: $("fdKennzeichen").value.trim(),
    list_price:    zahl("fdListenpreis"),
    drive_type:    $("fdAntrieb").value,
  };
  const res = await apiFetch(`/api/vehicles/${aktivesFahrzeug.id}`, { method: "PATCH", body });
  if (!res.ok) return zeigeAlert("datenAlert", await apiError(res), "danger");

  zeigeAlert("datenAlert", "✅ Fahrzeugdaten gespeichert.", "success");
  const option = document.querySelector(`#fahrzeugKontext option[value="${aktivesFahrzeug.code}"]`);
  if (option) option.textContent = `🚗 ${body.name}`;
  await Promise.all([ladeInfo(), ladeFahrzeugliste()]);
}

async function speichereKosten() {
  const body = {
    total_costs:  zahl("kGesamt"),
    depreciation: zahl("kAfa"),
    commute_km:   zahl("kArbeitsweg"),
    months:       zahl("kMonate") ?? 12,
    tax_rate:     zahl("kSteuersatz"),
  };
  if (body.total_costs == null) return zeigeAlert("kostenAlert", "Bitte die Gesamtkosten eintragen.", "warning");

  const res = await apiFetch(`/api/vehicles/${aktivesFahrzeug.id}/years/${$("jahrSelect").value}`, { method: "PUT", body });
  if (!res.ok) return zeigeAlert("kostenAlert", await apiError(res), "danger");

  zeigeAlert("kostenAlert", "✅ Kosten gespeichert.", "success");
  await ladeInfo();
}

// ── Export / Import ──────────────────────────────────────────

function initExportImport() {
  $("exportBtn").disabled = !aktivesFahrzeug;
  $("exportBtn").addEventListener("click", () => sichereFahrzeugDatei(aktivesFahrzeug));

  $("importBtn").addEventListener("click", async () => {
    const datei = $("importDatei").files[0];
    if (!datei) return zeigeAlert("importAlert", "Bitte eine Sicherungsdatei auswählen.", "warning");

    $("importBtn").disabled = true;
    try {
      const ergebnis = await stelleSicherungWiederHer(datei);
      if (!ergebnis) return;
      if (ergebnis.vehicle && ergebnis.vehicle.code !== aktivesFahrzeug?.code) {
        // anderes (ggf. neu angelegtes) Fahrzeug → auswählen
        alert(`✅ Wiederhergestellt\n${ergebnis.text}\n\nDas Fahrzeug „${ergebnis.vehicle.name}“ wird jetzt ausgewählt.`);
        waehleFahrzeug(ergebnis.vehicle.code);
        return location.reload();
      }
      zeigeAlert("importAlert", `✅ Wiederhergestellt\n${ergebnis.text}`, "info");
      await Promise.all([ladeInfo(), ladePruefung(), ladeFahrzeugliste()]);
    } catch (err) {
      zeigeAlert("importAlert", err.message, "danger");
    } finally {
      $("importBtn").disabled = false;
    }
  });
}

// ── Meine Fahrzeuge ──────────────────────────────────────────

async function ladeFahrzeugliste() {
  const tbody = $("vehicleTabelle");
  const res = await apiFetch("/api/vehicles");
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger p-3">${escapeHtml(await apiError(res))}</td></tr>`;
    return;
  }
  const vehicles = await res.json();
  if (!vehicles.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted p-3">Keine Fahrzeuge vorhanden.</td></tr>`;
    return;
  }

  tbody.innerHTML = vehicles.map(v => {
    const aktiv = v.code === aktivesFahrzeug?.code;
    return `
      <tr>
        <td>${aktiv
          ? `<strong>${escapeHtml(v.name)}</strong> <span class="badge bg-primary">aktiv</span>`
          : `<a href="#" class="waehle-vehicle" data-code="${escapeHtml(v.code)}" title="Als aktives Fahrzeug wählen">${escapeHtml(v.name)}</a>`}</td>
        <td class="d-none d-sm-table-cell">${escapeHtml(v.license_plate ?? "–")}</td>
        <td><code>${escapeHtml(v.code)}</code></td>
        <td>${v.is_default
          ? '<span class="badge bg-success">Standard</span>'
          : `<button class="btn btn-sm btn-outline-secondary set-default-vehicle-btn" data-id="${v.id}">Als Standard</button>`}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger delete-vehicle-btn" data-id="${v.id}" title="Fahrzeug löschen">
            <span class="mdi mdi-delete"></span>
          </button>
        </td>
      </tr>`;
  }).join("");
}

function initFahrzeugverwaltung() {
  const formular = $("newVehicleForm");
  const neuBtn   = $("newVehicleBtn");

  neuBtn.addEventListener("click", () => {
    formular.classList.remove("d-none");
    neuBtn.classList.add("d-none");
    $("vehicleNameInput").focus();
  });
  $("cancelVehicleBtn").addEventListener("click", () => {
    formular.classList.add("d-none");
    neuBtn.classList.remove("d-none");
  });

  $("createVehicleBtn").addEventListener("click", async () => {
    const name       = $("vehicleNameInput").value.trim();
    const is_default = $("vehicleDefault").checked;
    if (!name) return alert("Bitte einen Namen eingeben.");

    const res = await apiFetch("/api/vehicles", { method: "POST", body: { name, is_default } });
    if (!res.ok) return alert(await apiError(res, "Fehler beim Anlegen"));

    // Neues Fahrzeug direkt auswählen, damit man seine Daten erfassen kann
    waehleFahrzeug((await res.json()).code);
    location.reload();
  });

  $("vehicleTabelle").addEventListener("click", async e => {
    const waehlen = e.target.closest(".waehle-vehicle");
    if (waehlen) {
      e.preventDefault();
      waehleFahrzeug(waehlen.dataset.code);
      return location.reload();
    }

    const standard = e.target.closest(".set-default-vehicle-btn");
    if (standard) {
      const res = await apiFetch(`/api/vehicles/${standard.dataset.id}/default`, { method: "PATCH" });
      if (!res.ok) return alert(await apiError(res, "Fehler beim Setzen des Standard-Fahrzeugs"));
      return ladeFahrzeugliste();
    }

    const loeschen = e.target.closest(".delete-vehicle-btn");
    if (loeschen) {
      if (!confirm("Fahrzeug wirklich löschen? Die Fahrten bleiben erhalten, sind danach aber keinem Fahrzeug mehr zugeordnet.")) return;
      const res = await apiFetch(`/api/vehicles/${loeschen.dataset.id}`, { method: "DELETE" });
      if (!res.ok) return alert(await apiError(res, "Fehler beim Löschen"));
      location.reload();  // Navigation und aktives Fahrzeug neu bestimmen
    }
  });
}

// ── Start ────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  fuelleJahre();
  initFahrzeugverwaltung();
  $("jahrSelect").addEventListener("change", () => Promise.all([ladeInfo(), ladePruefung()]));
  $("datenSpeichernBtn").addEventListener("click", speichereDaten);
  $("kostenSpeichernBtn").addEventListener("click", speichereKosten);
  $("copyCodeBtn").addEventListener("click", () => navigator.clipboard.writeText($("autoCode").textContent));

  await fahrzeugBereit;
  $("autoInhalt").classList.toggle("d-none", !aktivesFahrzeug);
  $("keinFahrzeug").classList.toggle("d-none", !!aktivesFahrzeug);
  initExportImport();
  await Promise.all([ladeInfo(), ladePruefung(), ladeFahrzeugliste()]);
});
