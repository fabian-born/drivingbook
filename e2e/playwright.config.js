// ============================================================
// Browser-Tests: start.mjs setzt die Test-DB zurück und startet
// Backend (Port 3999) + Frontend mit /api-Proxy (Port 8099).
// Benötigt eine PostgreSQL-Instanz (DB_HOST, DB_PORT, DB_NAME,
// DB_USER, DB_PASSWORD) – ACHTUNG: Schema "public" wird geleert.
// ============================================================

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,                // gemeinsame Datenbank
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8099",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node start.mjs",
    url: "http://localhost:8099/api/health",
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
