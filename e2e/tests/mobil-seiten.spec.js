import { test, expect, devices } from "@playwright/test";
import { fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

// Kleinstes gängiges Smartphone (320 px breit, Touch) – im installierten Chromium
const { defaultBrowserType, ...iphoneSE } = devices["iPhone SE"];
test.use(iphoneSE);

async function mitDaten() {
  const user = await neuerUser(["VW Golf Variant"]);
  const arten = ["business", "private", "commute"];
  let km = 10000;
  for (const j of [jahr - 1, jahr]) {
    for (const m of [1, 2, 3]) {
      for (const d of [5, 15]) {
        km += 80;
        await fahrt(user, { odometer_km: km, destination: "Kunde Müller GmbH, Augsburg", trip_type: arten[(m + d) % 3],
                            timestamp: new Date(Date.UTC(j, m - 1, d, 8)).toISOString() });
      }
    }
  }
  return user;
}

// Kein horizontales Scrollen, kein Element ragt rechts hinaus
async function passtInDieBreite(page) {
  const zuBreit = await page.evaluate(() => [...document.querySelectorAll("main *, .filter-bar *")]
    .filter(e => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1)
    .map(e => e.tagName + "." + e.className).slice(0, 5));
  expect(zuBreit).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("Dashboard und Jahreshistorie auf dem Smartphone", async ({ page }) => {
  const user = await mitDaten();
  await loginImBrowser(page, user);

  // Dashboard: Kennzahlen, Aufteilung, Diagramm, Monatskarten statt Tabelle
  await expect(page.locator(".metric-value").first()).toBeVisible();
  await expect(page.locator(".metrics .col")).toHaveCount(3);
  await expect(page.locator(".month-table")).toBeHidden();
  await expect(page.locator(".list-group-item strong")).toHaveText(["März", "Februar", "Januar"]);
  await expect(page.locator("canvas")).toBeVisible();
  await passtInDieBreite(page);

  // Jahreshistorie: Vorjahr, Buttons neben der Jahresauswahl
  await page.goto("/history.html");
  // 6 Fahrten à 80 km, die erste des Jahres hat keinen Vorgänger → 400 km
  await expect(page.locator(".metric-value").first()).toHaveText("400 km");
  await expect(page.locator(".month-table")).toBeHidden();
  const auswahl = await page.locator("#historyYearSelect").boundingBox();
  const drucken = await page.locator("#historyPDFExport").boundingBox();
  expect(Math.abs(auswahl.y - drucken.y)).toBeLessThan(10);
  expect(drucken.height).toBeGreaterThanOrEqual(44);
  await passtInDieBreite(page);
});

test("Fahrten anzeigen auf dem Smartphone", async ({ page }) => {
  const user = await mitDaten();
  await loginImBrowser(page, user);
  await page.goto("/view.html");
  await page.selectOption("#yearSelect", String(jahr));
  await page.selectOption("#monthSelect", "01");

  await expect(page.locator(".trip-card")).toHaveCount(2);
  await expect(page.locator("#selectionTitle")).toHaveText(`Januar ${jahr}`);
  await expect(page.locator("#selectionKm")).toHaveText("160 km");
  await passtInDieBreite(page);

  // Bedienelemente groß genug, Löschen-Button überdeckt nichts
  const zuKlein = await page.$$eval(".filter-bar select, .filter-bar button, .trip-card input, .trip-card select, .trip-card .delete-btn",
    els => els.filter(e => e.getBoundingClientRect().height < 44).map(e => e.id || e.className));
  expect(zuKlein).toEqual([]);
  for (const karte of await page.locator(".trip-card").all()) {
    const loeschen = await karte.locator(".delete-btn").boundingBox();
    const art      = await karte.locator(".card-trip-type").boundingBox();
    expect(loeschen.y + loeschen.height <= art.y || art.y + art.height <= loeschen.y).toBe(true);
  }

  // Fahrtart ändern: Randfarbe und Summe folgen
  const karte = page.locator(".trip-card").first();
  await karte.locator(".card-trip-type").selectOption("commute");
  await expect(karte).toHaveCSS("border-left-color", "rgb(224, 138, 0)");
  await expect(page.locator("#selectionLegend")).toContainText("Arbeitsweg");

  // Jahresansicht: schreibgeschützte Karten mit Badge
  await page.selectOption("#monthSelect", "alle");
  await expect(page.locator(".month-divider")).toHaveCount(3);
  await expect(page.locator("#selectionTitle")).toHaveText(`Jahr ${jahr}`);
  await passtInDieBreite(page);
});

// Alle Bedienelemente ≥ 44 px (Checkboxen/Radios ausgenommen)
async function gutAntippbar(page) {
  const zuKlein = await page.$$eval(
    "main button, main input:not([type=checkbox]):not([type=radio]), main select, .container button, .container input:not([type=checkbox]):not([type=radio]), .container select",
    els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.className));
  expect(zuKlein).toEqual([]);
}

test("Konto, Auto-Info und Admin auf dem Smartphone", async ({ page }) => {
  const user = await neuerUser(["VW Golf Variant", "Tesla Model 3 Long Range"]);
  await fahrt(user, { odometer_km: 100, timestamp: `${jahr}-01-05T08:00:00Z`, vehicle_code: null });
  await loginImBrowser(page, user);

  for (const seite of ["/profile.html", "/auto.html"]) {
    await page.goto(seite);
    await expect(page.locator("main, .container").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await passtInDieBreite(page);
    await gutAntippbar(page);
  }

  await page.click(".navbar-toggler");   // Logout steckt im eingeklappten Menü
  await page.click("#logoutBtn");
  const { ADMIN_PASSWORD } = await import("../konstanten.js");
  await loginImBrowser(page, { username: "admin", password: ADMIN_PASSWORD, vehicles: [{}] });
  await page.goto("/admin.html");
  await page.click("#btnCheck");
  await expect(page.locator("#unassignedList .unassigned-entry", { hasText: user.username })).toBeVisible();
  await passtInDieBreite(page);
  await gutAntippbar(page);
});
