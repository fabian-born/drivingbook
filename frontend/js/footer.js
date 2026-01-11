// js/footer.js
async function ladeVersion() {
  try {
    const res = await fetch("release.ver", { cache: "no-store" });
    if (!res.ok) throw new Error("Version nicht gefunden");

    const version = (await res.text()).trim();
    document.getElementById("appVersion").innerText = version;
  } catch (err) {
    console.warn("Keine Versionsdatei gefunden");
    document.getElementById("appVersion").innerText = "dev";
  }
}

document.addEventListener("DOMContentLoaded", ladeVersion);
