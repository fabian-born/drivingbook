// js/footer.js
// Shows frontend and backend version (both are bumped automatically on commit)
async function loadVersion() {
  const [frontend, backend] = await Promise.all([
    fetch("release.ver", { cache: "no-store" })
      .then(res => res.ok ? res.text() : "dev").then(v => v.trim()).catch(() => "dev"),
    fetch(`${API_BASE_URL}/api/health`, { cache: "no-store" })
      .then(res => res.json()).then(data => data.version).catch(() => null),
  ]);

  document.getElementById("appVersion").innerText =
    backend ? `${frontend} · ${t("footer.backend")} ${backend}` : frontend;
}

document.addEventListener("DOMContentLoaded", loadVersion);
