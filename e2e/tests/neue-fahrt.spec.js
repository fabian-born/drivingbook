import { test, expect, devices } from "@playwright/test";
import { fahrt, loginImBrowser, neuerUser } from "./helpers.js";

// Kleinstes gängiges Smartphone (320 px breit, Touch) – im installierten Chromium
const { defaultBrowserType, ...iphoneSE } = devices["iPhone SE"];
test.use(iphoneSE);

test("Neue Fahrt ist auf dem Smartphone gut bedienbar", async ({ page }) => {
  const user = await neuerUser(["VW Golf Variant"]);
  await fahrt(user, { kmstand: 13500, timestamp: new Date(Date.now() - 2 * 86400e3).toISOString(), fahrtart: "geschäftlich" });

  await loginImBrowser(page, user);
  await page.goto("/driving.html");
  await expect(page.locator("#fahrzeugName")).toHaveText("VW Golf Variant");
  await expect(page.locator("#letzterStand")).toHaveText("Letzter Stand 13.500 km · vorgestern");

  // kein horizontales Scrollen, Menü-Button in der ersten Zeile
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const logo   = await page.locator(".navbar-brand").boundingBox();
  const toggle = await page.locator(".navbar-toggler").boundingBox();
  expect(Math.abs(logo.y - toggle.y)).toBeLessThan(20);

  // alle sichtbaren Bedienelemente mindestens 44 px hoch
  const zuKlein = await page.$$eval("main button, main input:not(.btn-check), main label.btn", els =>
    els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent.trim()));
  expect(zuKlein).toEqual([]);

  // Fahrtart-Kacheln: Beschriftung passt vollständig hinein
  for (const kachel of await page.locator(".fahrtart-kachel").all()) {
    expect(await kachel.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  }

  // Live-Hinweis zum km-Stand
  await page.fill("#kmstand", "13480");
  await expect(page.locator("#kmHinweis")).toHaveText("Kleiner als der letzte Stand (13.500 km)");
  await expect(page.locator("#kmstand")).toHaveClass(/is-invalid/);
  await page.fill("#kmstand", "13520");
  await expect(page.locator("#kmHinweis")).toHaveText("+20 km seit der letzten Fahrt");

  // Pflichtfelder
  await page.fill("#ziel", "");
  await page.getByRole("button", { name: "Fahrt speichern" }).click();
  await expect(page.locator("#statusMeldung")).toHaveText("Bitte km-Stand und Ziel eintragen.");

  await page.fill("#ziel", "Musterstraße 12, München");
  await page.tap("label[for=privat]");
  await page.getByRole("button", { name: "Fahrt speichern" }).click();
  await expect(page.locator("#statusMeldung")).toHaveText("✅ Fahrt gespeichert!");
  await expect(page.locator("#kmstand")).toHaveValue("");
  await expect(page.locator("#letzterStand")).toHaveText("Letzter Stand 13.520 km · gerade eben");

  // Export-Buttons gibt es nicht mehr
  await expect(page.getByText("CSV Export")).toHaveCount(0);
  await expect(page.getByText("JSON Export")).toHaveCount(0);
});
