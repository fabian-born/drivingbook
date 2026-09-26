// js/theme.js
// Light/dark mode. Loaded in the <head> so the page doesn't flash light
// first. Setting per device: "auto" (follows the system, also live),
// "hell" or "dunkel". Printing always uses the light theme.
// Fires "themaGeaendert" so that e.g. charts get redrawn.

(function () {
  const KEY    = "darstellung";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let druck    = false;

  // Trip type colors – separate steps per mode, checked against the background
  document.head.insertAdjacentHTML("beforeend", `<style>
    :root {
      --fa-business: #0d6efd; --fa-private: #198754; --fa-commute: #e08a00;
    }
    [data-bs-theme="dark"] {
      --fa-business: #3d8bfd; --fa-private: #20a36a; --fa-commute: #cc7e00;
    }
  </style>`);

  function modus() {
    try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; }
  }

  function istDunkel() {
    if (druck) return false;
    const m = modus();
    return m === "dunkel" || (m === "auto" && system.matches);
  }

  function anwenden() {
    const dunkel = istDunkel();
    const vorher = document.documentElement.getAttribute("data-bs-theme");
    document.documentElement.setAttribute("data-bs-theme", dunkel ? "dark" : "light");
    if (vorher && vorher !== (dunkel ? "dark" : "light")) {
      document.dispatchEvent(new CustomEvent("themaGeaendert", { detail: { dunkel } }));
    }
  }

  window.darstellung = {
    modus,
    istDunkel,
    setze(m) {
      try { localStorage.setItem(KEY, m); } catch { /* for this session only */ }
      anwenden();
    },
  };

  system.addEventListener("change", () => { if (modus() === "auto") anwenden(); });
  window.addEventListener("beforeprint", () => { druck = true;  anwenden(); });
  window.addEventListener("afterprint",  () => { druck = false; anwenden(); });

  anwenden();
})();
