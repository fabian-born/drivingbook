// js/auto.js
// Vehicle info: data and key figures of the active vehicle, comparison
// 1% rule ↔ logbook, management of all vehicles.

const $ = id => document.getElementById(id);

const euro    = n => n.toLocaleString(i18n.locale, { style: "currency", currency: "EUR" });
const km      = n => `${n.toLocaleString(i18n.locale)} km`;
const percent = (share, decimals = 1) =>
  percentText(share * 100, decimals);
const localDate   = d => new Date(d).toLocaleDateString(i18n.locale);

// Empty number fields → null
const num = id => ($(id).value === "" ? null : Number($(id).value));

function showAlert(id, text, type) {
  const box = $(id);
  box.className   = `alert alert-${type}`;
  box.textContent = text;
  if (type === "success") setTimeout(() => box.classList.add("d-none"), 3000);
}

// ── Year ─────────────────────────────────────────────────────

function fillYears() {
  const thisYear = new Date().getFullYear();
  for (let j = thisYear; j >= START_YEAR; j--) {
    $("yearSelect").insertAdjacentHTML("beforeend", `<option value="${j}">${j}</option>`);
  }
}

// ── Active vehicle ───────────────────────────────────────────

async function loadInfo() {
  if (!activeVehicle) return;
  const selectedYear = $("yearSelect").value;

  const res = await apiFetch(`/api/vehicles/${activeVehicle.id}/info?year=${selectedYear}`);
  if (!res.ok) return showAlert("dataAlert", await apiError(res), "danger");
  const info = await res.json();

  showVehicle(info.vehicle);
  showMetrics(info);
  showCosts(info.costs);
  showComparison(info);
}

// ── Check ────────────────────────────────────────────────────

const CHECK_STATUS  = {
  green:  { text: t("auto.check.green"),  color: "success" },
  yellow: { text: t("auto.check.yellow"), color: "warning" },
  red:    { text: t("auto.check.red"),    color: "danger" },
};
const SEVERITY = {
  error:   { icon: "mdi-close-circle",        color: "text-danger" },
  warning: { icon: "mdi-alert",               color: "text-warning" },
  info:    { icon: "mdi-information-outline", color: "text-secondary" },
};

async function loadCheck() {
  if (!activeVehicle) return;
  const res = await apiFetch(`/api/vehicles/${activeVehicle.id}/check?year=${$("yearSelect").value}`);
  if (!res.ok) return;
  const { status: checkStatus, findings: findings } = await res.json();

  $("checkBadge").className   = `badge text-bg-${CHECK_STATUS[checkStatus].color}`;
  $("checkBadge").textContent = CHECK_STATUS[checkStatus].text;

  $("checkList").innerHTML = findings.length === 0
    ? `<li class="list-group-item text-success"><span class="mdi mdi-check-circle me-2"></span>${escapeHtml(t("auto.check.none"))}</li>`
    : findings.map(b => `
        <li class="list-group-item d-flex gap-2">
          <span class="mdi ${SEVERITY[b.level].icon} ${SEVERITY[b.level].color}"></span>
          <div>
            ${b.timestamp ? `<div class="small text-muted">${escapeHtml(new Date(b.timestamp).toLocaleString(i18n.locale))} · ${escapeHtml(km(b.odometer_km))}</div>` : ""}
            ${escapeHtml(b.text)}
          </div>
        </li>`).join("");
}

function showVehicle(v) {
  $("infoName").textContent = v.name;
  $("infoCode").textContent = v.code;
  $("infoPlate").textContent = v.license_plate ?? "";
  $("infoPlate").classList.toggle("d-none", !v.license_plate);

  $("vdName").value        = v.name;
  $("vdPlate").value = v.license_plate ?? "";
  $("vdListPrice").value = v.list_price ?? "";
  $("vdDriveType").value     = v.drive_type;
}

function showMetrics({ overall: grandTotal, year_totals: selectedYear, year }) {
  $("kfOdometer").textContent = grandTotal.odometer_current != null ? km(grandTotal.odometer_current) : "–";
  $("kfKmYear").textContent    = km(selectedYear.total);
  const privateKm = selectedYear.private + selectedYear.commute;
  $("kfPrivate").textContent    = selectedYear.total > 0
    ? `${km(privateKm)} (${percent(privateKm / selectedYear.total)})`
    : "–";
  $("kfTrips").textContent   = selectedYear.trips.toLocaleString(i18n.locale);
  $("kfPeriod").textContent  = grandTotal.trips > 0
    ? t("auto.figures.period", { count: grandTotal.trips, trips: grandTotal.trips.toLocaleString(i18n.locale),
                                 from: localDate(grandTotal.first_trip), to: localDate(grandTotal.last_trip) })
    : t("auto.figures.noTrips");
  $("cmpYear").textContent = year;
}

function showCosts(k) {
  $("cTotal").value     = k?.total_costs ?? "";
  $("cDepreciation").value        = k?.depreciation || "";
  $("cCommuteKm").value = k?.commute_km || "";
  $("cMonths").value     = k?.months ?? 12;
  $("cTaxRate").value = k?.tax_rate ?? "";
}

function showComparison({ vehicle, costs: costs, year_totals: selectedYear, comparison: comparison }) {
  const hint = $("cmpHint");
  $("cmpResult").classList.toggle("d-none", !comparison);

  if (!comparison) {
    hint.textContent = vehicle.list_price == null
      ? t("auto.compare.needListPrice")
      : t("auto.compare.needCosts");
    hint.classList.remove("d-none");
    return;
  }
  hint.classList.add("d-none");

  // 1% rule
  const rateText = percentText(comparison.rate, 3);
  $("cmpFlatRateTotal").textContent = euro(comparison.flat_rate.total);
  $("cmpFlatRateDetail").innerHTML = [
    tHtml("auto.compare.flatRateDetail", { count: Number(costs.months), rate: rateText, price: euro(comparison.list_price), result: euro(comparison.flat_rate.private_use) }),
    comparison.flat_rate.commute > 0 ? tHtml("auto.compare.flatRateCommute", { km: costs.commute_km.toLocaleString(i18n.locale), result: euro(comparison.flat_rate.commute) }) : "",
    comparison.flat_rate.capped ? tHtml("auto.compare.capped", { costs: euro(comparison.total_costs) }) : "",
  ].filter(Boolean).join("<br>");

  // Logbook
  const logbook = comparison.logbook;
  $("cmpLogbookTotal").textContent = logbook ? euro(logbook.total) : "–";
  $("cmpLogbookDetail").textContent = logbook
    ? t("auto.compare.logbookDetail", { share: percent(logbook.private_share), private: km(selectedYear.private + selectedYear.commute),
                                        total: km(selectedYear.total), costs: euro(comparison.total_costs) })
    : t("auto.compare.noKm");

  $("cmpFlatRate").classList.toggle("winner", comparison.recommendation === "flat_rate");
  $("cmpLogbook").classList.toggle("winner", comparison.recommendation === "logbook");

  // Recommendation
  const recommendation = $("cmpRecommendation");
  recommendation.classList.toggle("d-none", !comparison.recommendation);
  if (comparison.recommendation) {
    const savings = comparison.tax_savings != null ? t("auto.compare.savings", { amount: euro(comparison.tax_savings) }) : "";
    recommendation.className = `alert mt-3 mb-3 alert-${comparison.recommendation === "logbook" ? "success" : "warning"}`;
    recommendation.innerHTML = comparison.recommendation === "logbook"
      ? tHtml("auto.compare.logbookWins", { amount: euro(comparison.difference), savings: savings })
      : tHtml("auto.compare.flatRateWins", { amount: euro(-comparison.difference), savings: savings });
  }

  // Threshold: up to which private share is the logbook worthwhile?
  const breakEven = comparison.break_even_share;
  $("cmpBreakEvenBox").classList.toggle("d-none", breakEven == null);
  if (breakEven != null) {
    $("cmpBreakEvenText").innerHTML = breakEven >= 1
      ? escapeHtml(t("auto.compare.alwaysEven"))
      : tHtml("auto.compare.breakEven", { share: percent(breakEven) }) +
        (logbook ? (selectedYear.total ? tHtml("auto.compare.yourShareIs", { share: percent(logbook.private_share) }) : escapeHtml(t("auto.compare.yourShareOpen"))) : ".");
    $("cmpBreakEvenZone").style.width = `${Math.min(breakEven, 1) * 100}%`;
    const marker = $("cmpPrivateMarker");
    marker.classList.toggle("d-none", !logbook);
    if (logbook) marker.style.left = `calc(${logbook.private_share * 100}% - 1px)`;
    $("cmpBreakEvenBar").setAttribute("aria-label",
      t("auto.compare.barLabel", { share: percent(breakEven) }) + (logbook ? t("auto.compare.barCurrent", { share: percent(logbook.private_share) }) : ""));
  }
}

async function saveData() {
  const body = {
    name:          $("vdName").value.trim(),
    license_plate: $("vdPlate").value.trim(),
    list_price:    num("vdListPrice"),
    drive_type:    $("vdDriveType").value,
  };
  const res = await apiFetch(`/api/vehicles/${activeVehicle.id}`, { method: "PATCH", body });
  if (!res.ok) return showAlert("dataAlert", await apiError(res), "danger");

  showAlert("dataAlert", t("auto.data.saved"), "success");
  const option = document.querySelector(`#vehicleContext option[value="${activeVehicle.code}"]`);
  if (option) option.textContent = `🚗 ${body.name}`;
  await Promise.all([loadInfo(), loadVehicleList()]);
}

async function saveCosts() {
  const body = {
    total_costs:  num("cTotal"),
    depreciation: num("cDepreciation"),
    commute_km:   num("cCommuteKm"),
    months:       num("cMonths") ?? 12,
    tax_rate:     num("cTaxRate"),
  };
  if (body.total_costs == null) return showAlert("costsAlert", t("auto.compare.needTotal"), "warning");

  const res = await apiFetch(`/api/vehicles/${activeVehicle.id}/years/${$("yearSelect").value}`, { method: "PUT", body });
  if (!res.ok) return showAlert("costsAlert", await apiError(res), "danger");

  showAlert("costsAlert", t("auto.compare.saved"), "success");
  await loadInfo();
}

// ── Export / Import ──────────────────────────────────────────

function initExportImport() {
  $("exportBtn").disabled = !activeVehicle;
  $("exportBtn").addEventListener("click", () => backupVehicleFile(activeVehicle));

  $("importBtn").addEventListener("click", async () => {
    const file = $("importFile").files[0];
    if (!file) return showAlert("importAlert", t("auto.backup.chooseFile"), "warning");

    $("importBtn").disabled = true;
    try {
      const result = await restoreBackup(file);
      if (!result) return;
      if (result.vehicle && result.vehicle.code !== activeVehicle?.code) {
        // different (possibly newly created) vehicle → select it
        alert(`${t("auto.backup.restored")}\n${result.text}\n\n${t("auto.backup.selecting", { name: result.vehicle.name })}`);
        selectVehicle(result.vehicle.code);
        return location.reload();
      }
      showAlert("importAlert", `${t("auto.backup.restored")}\n${result.text}`, "info");
      await Promise.all([loadInfo(), loadCheck(), loadVehicleList()]);
    } catch (err) {
      showAlert("importAlert", err.message, "danger");
    } finally {
      $("importBtn").disabled = false;
    }
  });
}

// ── My vehicles ──────────────────────────────────────────────

async function loadVehicleList() {
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
    const isActive = v.code === activeVehicle?.code;
    return `
      <tr>
        <td>${isActive
          ? `<strong>${escapeHtml(v.name)}</strong> <span class="badge bg-primary">${escapeHtml(t("auto.list.active"))}</span>`
          : `<a href="#" class="choose-vehicle" data-code="${escapeHtml(v.code)}" title="${escapeHtml(t("auto.list.select"))}">${escapeHtml(v.name)}</a>`}</td>
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

function initVehicleManagement() {
  const vehicleForm = $("newVehicleForm");
  const newBtn   = $("newVehicleBtn");

  newBtn.addEventListener("click", () => {
    vehicleForm.classList.remove("d-none");
    newBtn.classList.add("d-none");
    $("vehicleNameInput").focus();
  });
  $("cancelVehicleBtn").addEventListener("click", () => {
    vehicleForm.classList.add("d-none");
    newBtn.classList.remove("d-none");
  });

  $("createVehicleBtn").addEventListener("click", async () => {
    const name       = $("vehicleNameInput").value.trim();
    const is_default = $("vehicleDefault").checked;
    if (!name) return alert(t("auto.list.needName"));

    const res = await apiFetch("/api/vehicles", { method: "POST", body: { name, is_default } });
    if (!res.ok) return alert(await apiError(res, t("auto.list.createError")));

    // Select the new vehicle right away so its data can be entered
    selectVehicle((await res.json()).code);
    location.reload();
  });

  $("vehicleTabelle").addEventListener("click", async e => {
    const selectBtn = e.target.closest(".choose-vehicle");
    if (selectBtn) {
      e.preventDefault();
      selectVehicle(selectBtn.dataset.code);
      return location.reload();
    }

    const defaultBtn = e.target.closest(".set-default-vehicle-btn");
    if (defaultBtn) {
      const res = await apiFetch(`/api/vehicles/${defaultBtn.dataset.id}/default`, { method: "PATCH" });
      if (!res.ok) return alert(await apiError(res, t("auto.list.defaultError")));
      return loadVehicleList();
    }

    const deleteBtn = e.target.closest(".delete-vehicle-btn");
    if (deleteBtn) await deleteVehicle(Number(deleteBtn.dataset.id));
  });
}

// Delete a vehicle. If it has trips, they are moved to another vehicle
// (otherwise they would vanish from all views and the logbook PDF).
async function deleteVehicle(id) {
  const name = allVehicles.find(v => v.id === id)?.name ?? t("auto.delete.fallbackName");
  if (!confirm(t("auto.delete.confirmQuestion", { name }))) return;

  const res = await apiFetch(`/api/vehicles/${id}`, { method: "DELETE" });
  if (res.ok) return location.reload();   // re-determine navigation and active vehicle

  const failure = await res.json().catch(() => ({}));
  if (failure.code !== "HAS_TRIPS") return alert(failure.error || t("auto.delete.error"));

  const otherVehicles = allVehicles.filter(v => v.id !== id);
  if (otherVehicles.length === 0) {
    return alert(t("auto.delete.noTarget", { name, count: Number(failure.count) }));
  }

  $("deleteVehicleText").textContent = t("auto.delete.moveText", { name, count: Number(failure.count) });
  $("deleteVehicleTarget").innerHTML = otherVehicles.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join("");
  const modal = bootstrap.Modal.getOrCreateInstance($("deleteVehicleModal"));
  $("deleteVehicleConfirm").onclick = async () => {
    const r = await apiFetch(`/api/vehicles/${id}?target=${$("deleteVehicleTarget").value}`, { method: "DELETE" });
    if (!r.ok) return alert(await apiError(r, t("auto.delete.error")));
    modal.hide();
    location.reload();
  };
  modal.show();
}

// ── Start ────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  fillYears();
  initVehicleManagement();
  $("yearSelect").addEventListener("change", () => Promise.all([loadInfo(), loadCheck()]));
  $("saveDataBtn").addEventListener("click", saveData);
  $("saveCostsBtn").addEventListener("click", saveCosts);
  $("copyCodeBtn").addEventListener("click", () => navigator.clipboard.writeText($("infoCode").textContent));

  await vehicleReady;
  $("infoContent").classList.toggle("d-none", !activeVehicle);
  $("noVehicle").classList.toggle("d-none", !!activeVehicle);
  initExportImport();
  await Promise.all([loadInfo(), loadCheck(), loadVehicleList()]);
  onRefresh(() => Promise.all([loadInfo(), loadCheck()]));
});
