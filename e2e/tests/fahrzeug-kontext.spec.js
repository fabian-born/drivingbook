import { test, expect } from "@playwright/test";
import { fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

test("Fahrtenliste, Dashboard und neue Fahrten folgen dem aktiven Fahrzeug", async ({ page }) => {
  const user = await neuerUser(["Golf", "Tesla"]);
  const [golf, tesla] = user.vehicles;
  await fahrt(user, { odometer_km: 1000, destination: "Golf 1", timestamp: `${jahr}-01-10T08:00:00Z`, vehicle_code: golf.code });
  await fahrt(user, { odometer_km: 1100, destination: "Golf 2", timestamp: `${jahr}-01-11T08:00:00Z`, vehicle_code: golf.code, trip_type: "business" });
  await fahrt(user, { odometer_km: 50,   destination: "Tesla 1", timestamp: `${jahr}-01-12T08:00:00Z`, vehicle_code: tesla.code });

  await loginImBrowser(page, user);   // wählt Golf
  // Januar: Start 1.000, Ende 1.100, 100 km gefahren – alles geschäftlich
  await expect(page.locator(".month-table tbody tr")).toHaveText([/Januar\s+1\.000\s+1\.100\s+100\s+100 \(100 %\)/]);

  await page.goto("/view.html");
  await page.selectOption("#yearSelect", String(jahr));
  await page.selectOption("#monthSelect", "01");
  await expect(page.locator("#tripsTable [data-field=destination]")).toHaveText(["Golf 1", "Golf 2"]);

  await Promise.all([page.waitForEvent("load"), page.selectOption("#vehicleContext", { label: "🚗 Tesla" })]);
  await page.selectOption("#yearSelect", String(jahr));
  await page.selectOption("#monthSelect", "01");
  await expect(page.locator("#tripsTable [data-field=destination]")).toHaveText(["Tesla 1"]);

  await page.goto("/driving.html");
  await expect(page.locator("#vehicleHeaderName")).toHaveText("Tesla");
  await page.fill("#odometer", "80");
  await page.fill("#destination", "Neu im Tesla");
  await page.click("label[for=typeCommute]");
  await page.getByRole("button", { name: "Fahrt speichern" }).click();
  await expect(page.locator("#statusMessage")).toHaveClass(/alert-success/);

  await page.goto("/view.html");
  await page.selectOption("#yearSelect", String(jahr));
  await page.selectOption("#monthSelect", "alle");
  await expect(page.locator("#tripsTable .badge")).toHaveText(["Privat", "Arbeitsweg"]);
});
