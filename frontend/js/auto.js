// js/auto.js
// Vehicle info: data and key figures of the active vehicle, comparison
// 1% rule ↔ logbook, management of all vehicles.

const $ = id => document.getElementById(id);

const euro    = n => n.toLocaleString(i18n.locale, { style: "currency", currency: "EUR" });
const km      = n => `${n.toLocaleString(i18n.locale)} km`;
const prozent = (anteil, stellen = 1) =>
  prozentText(anteil * 100, stellen);
const datum   = d => new Date(d).toLocaleDateString(i18n.locale);

// Empty number fields → null
const zahl = id => ($(id).value === "" ? null : Number($(id).value));

function zeigeAlert(id, text, typ) {
  const box = $(id);
  box.className   = `alert alert-${typ}`;
  box.textContent = text;
  if (typ === "success") setTimeout(() => box.classList.add("d-none"), 3000);
}

// ── Year ─────────────────────────────────────────────────────

function fuelleJahre() {
  const aktuell = new Date().getFullYear();
  for (let j = aktuell; j >= START_JAHR; j--) {
    $("jahrSelect").insertAdjacentHTML("beforeend", `<option value="${j}">${j}</option>`);
  }
}

// ── Active vehicle ───────────────────────────────────────────

async function ladeInfo() {
  if (!aktivesFahrzeug) return;
  const jahr = $("jahrSelect").value;

  const res = await apiFetch(`/api/vehicles/${aktivesFahrzeug.id}/info?year=${jahr}`);
  if (!res.ok) return zeigeAlert("datenAlert", await apiError(res), "danger");
  const info = await res.json();

  zeigeFahrzeug(info.vehicle);
  zeigeKennzahlen(info);
  zeigeKosten(info.costs);
  zeigeVergleich(info);
}

// ── Check ────────────────────────────────────────────────────

const AMPEL  = {
  green:  { text: t("auto.check.green"),  farbe: "success" },
  yellow: { text: t("auto.check.yellow"), farbe: "warning" },
  red:    { text: t("auto.check.red"),    farbe: "danger" },
};
const STUFE = {
  error:   { icon: "mdi-close-circle",        farbe: "text-danger" },
  warning: { icon: "mdi-alert",               farbe: "text-warning" },
  info:    { icon: "mdi-information-outline", farbe: "text-secondary" },
};

async function ladePruefung() {
  if (!aktivesFahrzeug) return;
  const res = await apiFetch(`/api/vehicles/${aktivesFahrzeug.id}/check?year=${$("jahrSelect").value}`);
  if (!res.ok) return;
  const { status: ampel, findings: befunde } = await res.json();

  $("pruefAmpel").className   = `badge text-bg-${AMPEL[ampel].farbe}`;
  $("pruefAmpel").textContent = AMPEL[ampel].text;

  $("pruefListe").innerHTML = befunde.length === 0
    ? `<li class="list-group-item text-success"><span class="mdi mdi-check-circle me-2"></span>${escapeHtml(t("auto.check.none"))}</li>`
    : befunde.map(b => `
        <li class="list-group-item d-flex gap-2">
          <span class="mdi ${STUFE[b.level].icon} ${STUFE[b.level].farbe}"></span>
          <div>
            ${b.timestamp ? `<div class="small text-muted">${escapeHtml(new Date(b.timestamp).toLocaleString(i18n.locale))} · ${escapeHtml(km(b.odometer_km))}</div>` : ""}
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

function zeigeKennzahlen({ overall: gesamt, year_totals: jahr, year }) {
  $("kzKmAktuell").textContent = gesamt.odometer_current != null ? km(gesamt.odometer_current) : "–";
  $("kzKmJahr").textContent    = km(jahr.total);
  const privat = jahr.private + jahr.commute;
  $("kzPrivat").textContent    = jahr.total > 0
    ? `${km(privat)} (${prozent(privat / jahr.total)})`
    : "–";
  $("kzFahrten").textContent   = jahr.trips.toLocaleString(i18n.locale);
  $("kzZeitraum").textContent  = gesamt.trips > 0
    ? t("auto.figures.period", { count: gesamt.trips, trips: gesamt.trips.toLocaleString(i18n.locale),
                                 from: datum(gesamt.first_trip), to: datum(gesamt.last_trip) })
    : t("auto.figures.noTrips");
  $("vgJahr").textContent = year;
}

function zeigeKosten(k) {
  $("kGesamt").value     = k?.total_costs ?? "";
  $("kAfa").value        = k?.depreciation || "";
  $("kArbeitsweg").value = k?.commute_km || "";
  $("kMonate").value     = k?.months ?? 12;
  $("kSteuersatz").value = k?.tax_rate ?? "";
}

function zeigeVergleich({ vehicle, costs: kosten, year_totals: jahr, comparison: vg }) {
  const hinweis = $("vgHinweis");
  $("vgErgebnis").classList.toggle("d-none", !vg);

  if (!vg) {
    hinweis.textContent = vehicle.list_price == null
      ? t("auto.compare.needListPrice")
      : t("auto.compare.needCosts");
    hinweis.classList.remove("d-none");
    return;
  }
  hinweis.classList.add("d-none");

  // 1% rule
  const satz = prozentText(vg.rate, 3);
  $("vgPauschalSumme").textContent = euro(vg.flat_rate.total);
  $("vgPauschalDetail").innerHTML = [
    tHtml("auto.compare.flatRateDetail", { count: Number(kosten.months), rate: satz, price: euro(vg.list_price), result: euro(vg.flat_rate.private_use) }),
    vg.flat_rate.commute > 0 ? tHtml("auto.compare.flatRateCommute", { km: kosten.commute_km.toLocaleString(i18n.locale), result: euro(vg.flat_rate.commute) }) : "",
    vg.flat_rate.capped ? tHtml("auto.compare.capped", { costs: euro(vg.total_costs) }) : "",
  ].filter(Boolean).join("<br>");

  // Logbook
  const fb = vg.logbook;
  $("vgFahrtenbuchSumme").textContent = fb ? euro(fb.total) : "–";
  $("vgFahrtenbuchDetail").textContent = fb
    ? t("auto.compare.logbookDetail", { share: prozent(fb.private_share), private: km(jahr.private + jahr.commute),
                                        total: km(jahr.total), costs: euro(vg.total_costs) })
    : t("auto.compare.noKm");

  $("vgPauschal").classList.toggle("gewinner", vg.recommendation === "flat_rate");
  $("vgFahrtenbuch").classList.toggle("gewinner", vg.recommendation === "logbook");

  // Recommendation
  const empfehlung = $("vgEmpfehlung");
  empfehlung.classList.toggle("d-none", !vg.recommendation);
  if (vg.recommendation) {
    const ersparnis = vg.tax_savings != null ? t("auto.compare.savings", { amount: euro(vg.tax_savings) }) : "";
    empfehlung.className = `alert mt-3 mb-3 alert-${vg.recommendation === "logbook" ? "success" : "warning"}`;
    empfehlung.innerHTML = vg.recommendation === "logbook"
      ? tHtml("auto.compare.logbookWins", { amount: euro(vg.difference), savings: ersparnis })
      : tHtml("auto.compare.flatRateWins", { amount: euro(-vg.difference), savings: ersparnis });
  }

  // Threshold: up to which private share is the logbook worthwhile?
  const grenze = vg.break_even_share;
  $("vgBreakEvenBox").classList.toggle("d-none", grenze == null);
  if (grenze != null) {
    $("vgBreakEvenText").innerHTML = grenze >= 1
      ? escapeHtml(t("auto.compare.alwaysEven"))
      : tHtml("auto.compare.breakEven", { share: prozent(grenze) }) +
        (fb ? (jahr.total ? tHtml("auto.compare.yourShareIs", { share: prozent(fb.private_share) }) : escapeHtml(t("auto.compare.yourShareOpen"))) : ".");
    $("vgBreakEvenZone").style.width = `${Math.min(grenze, 1) * 100}%`;
    const marker = $("vgPrivatMarker");
    marker.classList.toggle("d-none", !fb);
    if (fb) marker.style.left = `calc(${fb.private_share * 100}% - 1px)`;
    $("vgBreakEvenBalken").setAttribute("aria-label",
      t("auto.compare.barLabel", { share: prozent(grenze) }) + (fb ? t("auto.compare.barCurrent", { share: prozent(fb.private_share) }) : ""));
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

  zeigeAlert("datenAlert", t("auto.data.saved"), "success");
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
  if (body.total_costs == null) return zeigeAlert("kostenAlert", t("auto.compare.needTotal"), "warning");

  const res = await apiFetch(`/api/vehicles/${aktivesFahrzeug.id}/years/${$("jahrSelect").value}`, { method: "PUT", body });
  if (!res.ok) return zeigeAlert("kostenAlert", await apiError(res), "danger");

  zeigeAlert("kostenAlert", t("auto.compare.saved"), "success");
  await ladeInfo();
}

// ── Export / Import ──────────────────────────────────────────

function initExportImport() {
  $("exportBtn").disabled = !aktivesFahrzeug;
  $("exportBtn").addEventListener("click", () => sichereFahrzeugDatei(aktivesFahrzeug));

  $("importBtn").addEventListener("click", async () => {
    const datei = $("importDatei").files[0];
    if (!datei) return zeigeAlert("importAlert", t("auto.backup.chooseFile"), "warning");

    $("importBtn").disabled = true;
    try {
      const ergebnis = await stelleSicherungWiederHer(datei);
      if (!ergebnis) return;
      if (ergebnis.vehicle && ergebnis.vehicle.code !== aktivesFahrzeug?.code) {
        // different (possibly newly created) vehicle → select it
        alert(`${t("auto.backup.restored")}\n${ergebnis.text}\n\n${t("auto.backup.selecting", { name: ergebnis.vehicle.name })}`);
        waehleFahrzeug(ergebnis.vehicle.code);
        return location.reload();
      }
      zeigeAlert("importAlert", `${t("auto.backup.restored")}\n${ergebnis.text}`, "info");
      await Promise.all([ladeInfo(), ladePruefung(), ladeFahrzeugliste()]);
    } catch (err) {
      zeigeAlert("importAlert", err.message, "danger");
    } finally {
      $("importBtn").disabled = false;
    }
  });
}

// ── My vehicles ──────────────────────────────────────────────

async function ladeFahrzeugliste() {
  const tbody = $("vehicleTabelle");
  const res = await apiFetch("/api/vehicles");
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger p-3">${escapeHtml(await apiError(res))}</td></tr>`;
    return;
  }
  const vehicles = await res.json();
  if (!vehicles.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted p-3">${escapeHtml(t("auto.list.empty"))}</td></tr>`;
    return;
  }

  tbody.innerHTML = vehicles.map(v => {
    const aktiv = v.code === aktivesFahrzeug?.code;
    return `
      <tr>
        <td>${aktiv
          ? `<strong>${escapeHtml(v.name)}</strong> <span class="badge bg-primary">${escapeHtml(t("auto.list.active"))}</span>`
          : `<a href="#" class="waehle-vehicle" data-code="${escapeHtml(v.code)}" title="${escapeHtml(t("auto.list.select"))}">${escapeHtml(v.name)}</a>`}</td>
        <td class="d-none d-sm-table-cell">${escapeHtml(v.license_plate ?? "–")}</td>
        <td><code>${escapeHtml(v.code)}</code></td>
        <td>${v.is_default
          ? `<span class="badge bg-success">${escapeHtml(t("auto.list.default"))}</span>`
          : `<button class="btn btn-sm btn-outline-secondary set-default-vehicle-btn" data-id="${v.id}">${escapeHtml(t("auto.list.makeDefault"))}</button>`}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger delete-vehicle-btn" data-id="${v.id}" title="${escapeHtml(t("auto.delete.title"))}">
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
    if (!name) return alert(t("auto.list.needName"));

    const res = await apiFetch("/api/vehicles", { method: "POST", body: { name, is_default } });
    if (!res.ok) return alert(await apiError(res, t("auto.list.createError")));

    // Select the new vehicle right away so its data can be entered
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
      if (!res.ok) return alert(await apiError(res, t("auto.list.defaultError")));
      return ladeFahrzeugliste();
    }

    const loeschen = e.target.closest(".delete-vehicle-btn");
    if (loeschen) await loescheFahrzeug(Number(loeschen.dataset.id));
  });
}

// Delete a vehicle. If it has trips, they are moved to another vehicle
// (otherwise they would vanish from all views and the logbook PDF).
async function loescheFahrzeug(id) {
  const name = alleFahrzeuge.find(v => v.id === id)?.name ?? t("auto.delete.fallbackName");
  if (!confirm(t("auto.delete.confirmQuestion", { name }))) return;

  const res = await apiFetch(`/api/vehicles/${id}`, { method: "DELETE" });
  if (res.ok) return location.reload();   // re-determine navigation and active vehicle

  const fehler = await res.json().catch(() => ({}));
  if (fehler.code !== "HAS_TRIPS") return alert(fehler.error || t("auto.delete.error"));

  const andere = alleFahrzeuge.filter(v => v.id !== id);
  if (andere.length === 0) {
    return alert(t("auto.delete.noTarget", { name, count: Number(fehler.count) }));
  }

  $("loeschenText").textContent = t("auto.delete.moveText", { name, count: Number(fehler.count) });
  $("loeschenZiel").innerHTML = andere.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join("");
  const modal = bootstrap.Modal.getOrCreateInstance($("loeschenModal"));
  $("loeschenBestaetigen").onclick = async () => {
    const r = await apiFetch(`/api/vehicles/${id}?target=${$("loeschenZiel").value}`, { method: "DELETE" });
    if (!r.ok) return alert(await apiError(r, t("auto.delete.error")));
    modal.hide();
    location.reload();
  };
  modal.show();
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
  beiAktualisierung(() => Promise.all([ladeInfo(), ladePruefung()]));
});
