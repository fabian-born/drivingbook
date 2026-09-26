// ============================================================
// Screenshots für die Projektseite (docs/). Nutzt dieselbe
// Umgebung wie die Browser-Tests (start.mjs, Test-DB wird geleert):
//   npx playwright test -c screenshots.config.js
// Bilder landen in docs/img/.
// ============================================================

import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  testDir: "./screenshots",
  reporter: "list",
  projects: [{ name: "screenshots", use: { browserName: "chromium", launchOptions: {
    args: ["--lang=de-DE"], env: { ...process.env, LANGUAGE: "de_DE", LANG: "de_DE.UTF-8" },
  }  } }],
});
