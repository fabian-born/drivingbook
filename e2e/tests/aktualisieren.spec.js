import { test, expect } from "@playwright/test";
import { fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

// Sichtbarkeit der Seite simulieren (Wechsel in eine andere App / einen anderen Tab)
async function setzeSichtbar(page, sichtbar) {
  await page.evaluate(v => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !v });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, sichtbar);
}

const monatsKm = page => page.locator(".kennzahl-wert").first();

test("Dashboard lädt neu nach Rückkehr in die App und alle 5 Minuten", async ({ page }) => {
  await page.clock.install();
  const user = await neuerUser();
  const jetzt = Date.now();
  await fahrt(user, { odometer_km: 1000, timestamp: new Date(jetzt - 3600e3).toISOString() });
  await fahrt(user, { odometer_km: 1100, timestamp: new Date(jetzt - 1800e3).toISOString() });

  await loginImBrowser(page, user);
  await expect(monatsKm(page)).toHaveText("100 km");

  // Home Assistant trägt im Hintergrund eine Fahrt ein
  await fahrt(user, { odometer_km: 1150, timestamp: new Date(jetzt - 600e3).toISOString() });

  // kurz weg (< 30 s) → kein Neuladen
  await setzeSichtbar(page, false);
  await page.clock.fastForward(10_000);
  await setzeSichtbar(page, true);
  await page.clock.fastForward(1_000);
  await expect(monatsKm(page)).toHaveText("100 km");

  // länger weg → Neuladen beim Zurückkommen
  await setzeSichtbar(page, false);
  await page.clock.fastForward(40_000);
  await setzeSichtbar(page, true);
  await page.clock.fastForward(1_000);
  await expect(monatsKm(page)).toHaveText("150 km");

  // ohne Wechsel: spätestens nach 5 Minuten
  await fahrt(user, { odometer_km: 1180, timestamp: new Date(jetzt - 300e3).toISOString() });
  await page.clock.fastForward("05:01");
  await expect(monatsKm(page)).toHaveText("180 km");
});

test("keine Aktualisierung mitten in einer Eingabe", async ({ page }) => {
  await page.clock.install();
  const user = await neuerUser();
  await fahrt(user, { odometer_km: 5000, timestamp: new Date(Date.now() - 86400e3).toISOString() });

  await loginImBrowser(page, user);
  await page.goto("/driving.html");
  await expect(page.locator("#letzterStand")).toContainText("5.000 km");

  await fahrt(user, { odometer_km: 5080, timestamp: new Date(Date.now() - 3600e3).toISOString() });
  await page.fill("#kmstand", "51");                 // Nutzer tippt gerade
  await page.clock.fastForward("05:01");
  await expect(page.locator("#letzterStand")).toContainText("5.000 km");
  await expect(page.locator("#kmstand")).toHaveValue("51");

  await page.locator("#ziel").focus();               // Feld verlassen → dann aktualisieren
  await page.locator("#ziel").blur();
  await page.clock.fastForward(2_000);
  await expect(page.locator("#letzterStand")).toContainText("5.080 km");
  await expect(page.locator("#kmstand")).toHaveValue("51");
});
