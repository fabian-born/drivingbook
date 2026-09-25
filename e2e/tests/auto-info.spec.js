import { test, expect } from "@playwright/test";
import { fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

test("Steuervergleich 1-%-Regel ↔ Fahrtenbuch mit Arbeitsweg", async ({ page }) => {
  const user = await neuerUser();
  await fahrt(user, { kmstand: 10000, timestamp: `${jahr}-01-10T08:00:00Z` });
  await fahrt(user, { kmstand: 10800, timestamp: `${jahr}-02-10T08:00:00Z`, fahrtart: "geschäftlich" });
  await fahrt(user, { kmstand: 11000, timestamp: `${jahr}-03-10T08:00:00Z` });                            // 200 privat
  await fahrt(user, { kmstand: 11100, timestamp: `${jahr}-03-11T08:00:00Z`, fahrtart: "arbeitsweg" });    // 100 Arbeitsweg
  await fahrt(user, { kmstand: 13500, timestamp: `${jahr}-03-20T08:00:00Z`, fahrtart: "geschäftlich" });

  await loginImBrowser(page, user);
  await page.goto("/auto.html");
  await expect(page.locator("#kzKmJahr")).toHaveText("3.500 km");
  await expect(page.locator("#kzPrivat")).toHaveText("300 km (8,6 %)");
  await expect(page.locator("#vgHinweis")).toContainText("Bruttolistenpreis");

  await page.fill("#fdKennzeichen", "m-ab 1234");
  await page.fill("#fdListenpreis", "42500");
  await page.click("#datenSpeichernBtn");
  await expect(page.locator("#autoKennzeichen")).toHaveText("M-AB 1234");

  await page.fill("#kGesamt", "8000");
  await page.fill("#kAfa", "3500");
  await page.fill("#kArbeitsweg", "15");
  await page.fill("#kSteuersatz", "35");
  await page.click("#kostenSpeichernBtn");

  await expect(page.locator("#vgPauschalSumme")).toHaveText("7.395,00 €");      // 5.100 + 2.295
  await expect(page.locator("#vgFahrtenbuchSumme")).toHaveText("685,71 €");     // 8.000 × 300/3.500
  await expect(page.locator("#vgFahrtenbuch")).toHaveClass(/gewinner/);
  await expect(page.locator("#vgEmpfehlung")).toContainText("Das Fahrtenbuch lohnt sich");
});

test("Prüfung zeigt Auffälligkeiten als Ampel", async ({ page }) => {
  const user = await neuerUser();
  await fahrt(user, { kmstand: 1000, timestamp: `${jahr}-01-05T08:00:00Z` });
  await fahrt(user, { kmstand: 1040, timestamp: `${jahr}-01-06T08:00:00Z`, ziel: "52.52, 13.40" });
  await fahrt(user, { kmstand: 2600, timestamp: `${jahr}-01-08T08:00:00Z` });

  await loginImBrowser(page, user);
  await page.goto("/auto.html");
  await expect(page.locator("#pruefAmpel")).toHaveText("Bitte prüfen");
  await expect(page.locator("#pruefListe li")).toHaveText([/nur eine Koordinate/, /1\.560 km seit der vorherigen Fahrt/]);

  await page.selectOption("#jahrSelect", String(jahr - 1));
  await expect(page.locator("#pruefAmpel")).toHaveText("Alles in Ordnung");
});
