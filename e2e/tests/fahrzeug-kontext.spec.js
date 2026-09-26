import { test, expect } from "@playwright/test";
import { fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

test("Fahrtenliste, Dashboard und neue Fahrten folgen dem aktiven Fahrzeug", async ({ page }) => {
  const user = await neuerUser(["Golf", "Tesla"]);
  const [golf, tesla] = user.vehicles;
  await fahrt(user, { kmstand: 1000, ziel: "Golf 1", timestamp: `${jahr}-01-10T08:00:00Z`, vehicle_code: golf.code });
  await fahrt(user, { kmstand: 1100, ziel: "Golf 2", timestamp: `${jahr}-01-11T08:00:00Z`, vehicle_code: golf.code, fahrtart: "geschäftlich" });
  await fahrt(user, { kmstand: 50,   ziel: "Tesla 1", timestamp: `${jahr}-01-12T08:00:00Z`, vehicle_code: tesla.code });

  await loginImBrowser(page, user);   // wählt Golf
  // Januar: Start 1.000, Ende 1.100, 100 km gefahren – alles geschäftlich
  await expect(page.locator(".monats-tabelle tbody tr")).toHaveText([/Januar\s+1\.000\s+1\.100\s+100\s+100 \(100 %\)/]);

  await page.goto("/view.html");
  await page.selectOption("#jahrSelect", String(jahr));
  await page.selectOption("#monatSelect", "01");
  await expect(page.locator("#fahrtenTabelle [data-field=ziel]")).toHaveText(["Golf 1", "Golf 2"]);

  await Promise.all([page.waitForEvent("load"), page.selectOption("#fahrzeugKontext", { label: "🚗 Tesla" })]);
  await page.selectOption("#jahrSelect", String(jahr));
  await page.selectOption("#monatSelect", "01");
  await expect(page.locator("#fahrtenTabelle [data-field=ziel]")).toHaveText(["Tesla 1"]);

  await page.goto("/driving.html");
  await expect(page.locator("#fahrzeugName")).toHaveText("Tesla");
  await page.fill("#kmstand", "80");
  await page.fill("#ziel", "Neu im Tesla");
  await page.click("label[for=arbeitsweg]");
  await page.getByRole("button", { name: "Fahrt speichern" }).click();
  await expect(page.locator("#statusMeldung")).toHaveClass(/alert-success/);

  await page.goto("/view.html");
  await page.selectOption("#jahrSelect", String(jahr));
  await page.selectOption("#monatSelect", "alle");
  await expect(page.locator("#fahrtenTabelle .badge")).toHaveText(["Privat", "Arbeitsweg"]);
});
