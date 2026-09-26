// js/nav.js
// Main navigation – defined once, identical on all pages.
// Included right after <nav id="hauptnavigation"> (no flicker);
// config.js marks the active page and admin entries.
document.getElementById("hauptnavigation").innerHTML = `
  <div class="container-fluid">
    <a class="navbar-brand fw-bold" href="index.html"><img src="drivingbooklogo.png" alt="${t("nav.logoAlt")}" style="height: clamp(34px, 11vw, 50px); width: auto;"></a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"
      aria-controls="navbarNav" aria-expanded="false" aria-label="${t("nav.openMenu")}">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarNav">
      <ul class="navbar-nav ms-auto">
        <li class="nav-item"><a class="nav-link" href="index.html">${t("nav.dashboard")}</a></li>
        <li class="nav-item"><a class="nav-link" href="driving.html">${t("nav.newTrip")}</a></li>
        <li class="nav-item"><a class="nav-link" href="view.html">${t("nav.trips")}</a></li>
        <li class="nav-item"><a class="nav-link" href="history.html">${t("nav.history")}</a></li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">${t("nav.profile")}</a>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="profile.html">${t("nav.account")}</a></li>
            <li><a class="dropdown-item" href="auto.html">${t("nav.vehicleInfo")}</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><h6 class="dropdown-header">${t("nav.appearance")}</h6></li>
            <li><button type="button" class="dropdown-item d-flex align-items-center gap-2" data-theme="auto">
              <span aria-hidden="true">◐</span>${t("nav.themeAuto")}<span class="ms-auto darstellung-haken">✓</span></button></li>
            <li><button type="button" class="dropdown-item d-flex align-items-center gap-2" data-theme="hell">
              <span aria-hidden="true">☀</span>${t("nav.themeLight")}<span class="ms-auto darstellung-haken">✓</span></button></li>
            <li><button type="button" class="dropdown-item d-flex align-items-center gap-2" data-theme="dunkel">
              <span aria-hidden="true">☾</span>${t("nav.themeDark")}<span class="ms-auto darstellung-haken">✓</span></button></li>
            <li class="nav-admin d-none"><hr class="dropdown-divider"></li>
            <li class="nav-admin d-none"><a class="dropdown-item" href="admin.html">${t("nav.admin")}</a></li>
          </ul>
        </li>
      </ul>
      <button id="logoutBtn" class="btn btn-outline-light btn-sm ms-lg-2 mb-2 mb-lg-0">${t("nav.logout")}</button>
    </div>
  </div>`;
