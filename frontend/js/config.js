// js/config.js
const API_BASE_URL = "https://fahrtenbuch-backend.home.fabianborn.net/";
const START_JAHR = 2024;


const logoutBtn = document.getElementById("logoutBtn");

logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem("authToken");
  window.location.href = "login.html";
});

