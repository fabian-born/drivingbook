// js/nav.js
// Hauptnavigation – einmal definiert, auf allen Seiten gleich.
// Wird direkt nach <nav id="hauptnavigation"> eingebunden (kein Flackern);
// aktive Seite und Admin-Einträge markiert config.js.
document.getElementById("hauptnavigation").innerHTML = `
  <div class="container-fluid">
    <a class="navbar-brand fw-bold" href="index.html"><img src="drivingbooklogo.png" height="50" alt="Fahrtenbuch"></a>
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
            <li class="nav-admin d-none"><hr class="dropdown-divider"></li>
            <li class="nav-admin d-none"><a class="dropdown-item" href="admin.html">Admin</a></li>
          </ul>
        </li>
      </ul>
      <button id="logoutBtn" class="btn btn-outline-light btn-sm ms-2">Logout</button>
    </div>
  </div>`;
