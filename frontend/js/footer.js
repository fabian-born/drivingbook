// js/footer.js
// Zeigt Frontend- und Backend-Version (beide werden beim Commit automatisch hochgezählt)
async function ladeVersion() {
  const [frontend, backend] = await Promise.all([
    fetch("release.ver", { cache: "no-store" })
      .then(res => res.ok ? res.text() : "dev").then(v => v.trim()).catch(() => "dev"),
    fetch(`${API_BASE_URL}/api/health`, { cache: "no-store" })
      .then(res => res.json()).then(data => data.version).catch(() => null),
  ]);

  document.getElementById("appVersion").innerText =
    backend ? `${frontend} · Backend ${backend}` : frontend;
}

document.addEventListener("DOMContentLoaded", ladeVersion);
