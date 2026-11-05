// js/footer.js
// Shows frontend and backend version (both are bumped automatically on commit)
async function loadVersion() {
  const versionEl = document.getElementById("appVersion");
  if (!versionEl) return;  // login/register: no version shown
  const [frontend, backend] = await Promise.all([
    fetch("release.ver", { cache: "no-store" })
      .then(res => res.ok ? res.text() : "dev").then(v => v.trim()).catch(() => "dev"),
    fetch(`${API_BASE_URL}/api/health`, { cache: "no-store" })
      .then(res => res.json()).then(data => data.version).catch(() => null),
  ]);

  versionEl.innerText =
    backend ? `${frontend} · ${t("footer.backend")} ${backend}` : frontend;
}

const yearEl = document.getElementById("year");
if (yearEl) yearEl.innerText = new Date().getFullYear();

document.addEventListener("DOMContentLoaded", loadVersion);
