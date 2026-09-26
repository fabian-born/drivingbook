// js/theme.js
// Light/dark mode. Loaded in the <head> so the page doesn't flash light
// first. Setting per device: "auto" (follows the system, also live),
// "hell" or "dunkel". Printing always uses the light theme.
// Fires "themaGeaendert" so that e.g. charts get redrawn.

(function () {
  const KEY    = "darstellung";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let printing    = false;

  // Trip type colors – separate steps per mode, checked against the background
  document.head.insertAdjacentHTML("beforeend", `<style>
    :root {
      --fa-business: #0d6efd; --fa-private: #198754; --fa-commute: #e08a00;
    }
    [data-bs-theme="dark"] {
      --fa-business: #3d8bfd; --fa-private: #20a36a; --fa-commute: #cc7e00;
    }
  </style>`);

  function themeMode() {
    try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; }
  }

  function isDark() {
    if (printing) return false;
    const m = themeMode();
    return m === "dunkel" || (m === "auto" && system.matches);
  }

  function applyTheme() {
    const dark = isDark();
    const previousTheme = document.documentElement.getAttribute("data-bs-theme");
    document.documentElement.setAttribute("data-bs-theme", dark ? "dark" : "light");
    if (previousTheme && previousTheme !== (dark ? "dark" : "light")) {
      document.dispatchEvent(new CustomEvent("themaGeaendert", { detail: { dark: dark } }));
    }
  }

  window.theme = {
    mode: themeMode,
    isDark: isDark,
    set(m) {
      try { localStorage.setItem(KEY, m); } catch { /* for this session only */ }
      applyTheme();
    },
  };

  system.addEventListener("change", () => { if (themeMode() === "auto") applyTheme(); });
  window.addEventListener("beforeprint", () => { printing = true;  applyTheme(); });
  window.addEventListener("afterprint",  () => { printing = false; applyTheme(); });

  applyTheme();
})();
