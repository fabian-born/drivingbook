import { test, expect } from "@playwright/test";
import { fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

test("Steuervergleich 1-%-Regel ↔ Fahrtenbuch mit Arbeitsweg", async ({ page }) => {
  const user = await neuerUser();
  await fahrt(user, { odometer_km: 10000, timestamp: `${jahr}-01-10T08:00:00Z` });
  await fahrt(user, { odometer_km: 10800, timestamp: `${jahr}-02-10T08:00:00Z`, trip_type: "business" });
  await fahrt(user, { odometer_km: 11000, timestamp: `${jahr}-03-10T08:00:00Z` });                            // 200 privat
  await fahrt(user, { odometer_km: 11100, timestamp: `${jahr}-03-11T08:00:00Z`, trip_type: "commute" });    // 100 Arbeitsweg
  await fahrt(user, { odometer_km: 13500, timestamp: `${jahr}-03-20T08:00:00Z`, trip_type: "business" });

  await loginImBrowser(page, user);
  await page.goto("/auto.html");
  await expect(page.locator("#kfKmYear")).toHaveText("3.500 km");
  await expect(page.locator("#kfPrivate")).toHaveText("300 km (8,6 %)");
  await expect(page.locator("#cmpHint")).toContainText("Bruttolistenpreis");

  await page.fill("#vdPlate", "m-ab 1234");
  await page.fill("#vdListPrice", "42500");
  await page.click("#saveDataBtn");
  await expect(page.locator("#infoPlate")).toHaveText("M-AB 1234");

  await page.fill("#cTotal", "8000");
  await page.fill("#cDepreciation", "3500");
  await page.fill("#cCommuteKm", "15");
  await page.fill("#cTaxRate", "35");
  await page.click("#saveCostsBtn");

  await expect(page.locator("#cmpFlatRateTotal")).toHaveText("7.395,00 €");      // 5.100 + 2.295
  await expect(page.locator("#cmpLogbookTotal")).toHaveText("685,71 €");     // 8.000 × 300/3.500
  await expect(page.locator("#cmpLogbook")).toHaveClass(/winner/);
  await expect(page.locator("#cmpRecommendation")).toContainText("Das Fahrtenbuch lohnt sich");
});

test("Prüfung zeigt Auffälligkeiten als Ampel", async ({ page }) => {
  const user = await neuerUser();
  await fahrt(user, { odometer_km: 1000, timestamp: `${jahr}-01-05T08:00:00Z` });
  await fahrt(user, { odometer_km: 1040, timestamp: `${jahr}-01-06T08:00:00Z`, destination: "52.52, 13.40" });
  await fahrt(user, { odometer_km: 2600, timestamp: `${jahr}-01-08T08:00:00Z` });

  await loginImBrowser(page, user);
  await page.goto("/auto.html");
  await expect(page.locator("#checkBadge")).toHaveText("Bitte prüfen");
  await expect(page.locator("#checkList li")).toHaveText([/nur eine Koordinate/, /1\.560 km seit der vorherigen Fahrt/]);

  await page.selectOption("#yearSelect", String(jahr - 1));
  await expect(page.locator("#checkBadge")).toHaveText("Alles in Ordnung");
});
