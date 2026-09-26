// js/nav.js
// Hauptnavigation – einmal definiert, auf allen Seiten gleich.
// Wird direkt nach <nav id="hauptnavigation"> eingebunden (kein Flackern);
// aktive Seite und Admin-Einträge markiert config.js.
document.getElementById("hauptnavigation").innerHTML = `
  <div class="container-fluid">
    <a class="navbar-brand fw-bold" href="index.html"><img src="drivingbooklogo.png" alt="Fahrtenbuch" style="height: clamp(34px, 11vw, 50px); width: auto;"></a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"
      aria-controls="navbarNav" aria-expanded="false" aria-label="Menü öffnen">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarNav">
      <ul class="navbar-nav ms-auto">
        <li class="nav-item"><a class="nav-link" href="index.html">Dashboard</a></li>
        <li class="nav-item"><a class="nav-link" href="driving.html">Neue Fahrt</a></li>
        <li class="nav-item"><a class="nav-link" href="view.html">Fahrten anzeigen</a></li>
        <li class="nav-item"><a class="nav-link" href="history.html">Jahreshistorie</a></li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Profil</a>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="profile.html">Konto</a></li>
            <li><a class="dropdown-item" href="auto.html">Auto-Info</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><h6 class="dropdown-header">Darstellung</h6></li>
            <li><button type="button" class="dropdown-item d-flex align-items-center gap-2" data-darstellung="auto">
              <span aria-hidden="true">◐</span>Automatisch<span class="ms-auto darstellung-haken">✓</span></button></li>
            <li><button type="button" class="dropdown-item d-flex align-items-center gap-2" data-darstellung="hell">
              <span aria-hidden="true">☀</span>Hell<span class="ms-auto darstellung-haken">✓</span></button></li>
            <li><button type="button" class="dropdown-item d-flex align-items-center gap-2" data-darstellung="dunkel">
              <span aria-hidden="true">☾</span>Dunkel<span class="ms-auto darstellung-haken">✓</span></button></li>
            <li class="nav-admin d-none"><hr class="dropdown-divider"></li>
            <li class="nav-admin d-none"><a class="dropdown-item" href="admin.html">Admin</a></li>
          </ul>
        </li>
      </ul>
      <button id="logoutBtn" class="btn btn-outline-light btn-sm ms-lg-2 mb-2 mb-lg-0">Logout</button>
    </div>
  </div>`;
