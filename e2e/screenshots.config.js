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
    args: ["--lang=en-GB"], env: { ...process.env, LANGUAGE: "en_GB", LANG: "en_GB.UTF-8" },
  }  } }],
});
