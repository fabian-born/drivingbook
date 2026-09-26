import { test, expect } from "@playwright/test";
import { fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";
import { ADMIN_PASSWORD } from "../konstanten.js";

test("Admin räumt doppelte Fahrten und Fahrten ohne Fahrzeug auf", async ({ page }) => {
  const user = await neuerUser(["Golf"], { prefix: "putz" });
  await fahrt(user, { odometer_km: 100, timestamp: `${jahr}-03-01T08:00:00.000Z` });
  await fahrt(user, { odometer_km: 100, timestamp: `${jahr}-03-01T08:00:00.300Z`, force: true });   // Doppelklick
  await fahrt(user, { odometer_km: 150, timestamp: `${jahr}-03-02T08:00:00Z`, vehicle_code: null });

  page.on("dialog", d => d.accept());
  await loginImBrowser(page, { username: "admin", password: ADMIN_PASSWORD, vehicles: [{}] });
  await page.goto("/admin.html");
  await page.click("#btnPruefen");

  const gruppe = page.locator("#duplikatListe .border", { hasText: user.username });
  await expect(gruppe.locator("tr")).toHaveCount(2);
  await expect(gruppe.locator(".badge")).toHaveText(["behalten", "entfernen"]);

  // nur diese Gruppe löschen
  await page.locator(".duplikat-gruppe").uncheck();
  await gruppe.locator(".duplikat-gruppe").check();
  await page.click("#btnDuplikateLoeschen");
  await expect(page.locator("#aufraeumenAlert")).toContainText("1 doppelte Fahrt gelöscht");
  await expect(page.locator("#duplikatListe .border", { hasText: user.username })).toHaveCount(0);

  const zeile = page.locator("#ohneListe .ohne-eintrag", { hasText: user.username });
  await expect(zeile).toContainText("1");
  await zeile.locator(".ohne-zuordnen").click();
  await expect(page.locator("#aufraeumenAlert")).toContainText("1 Fahrt zugeordnet");
  await expect(page.locator("#ohneListe .ohne-eintrag", { hasText: user.username })).toHaveCount(0);
});

test("Aufräumen ist für normale Benutzer nicht sichtbar", async ({ page }) => {
  const user = await neuerUser();
  await loginImBrowser(page, user);
  await page.goto("/admin.html");
  await expect(page.locator("#adminNoAccess")).toBeVisible();
  await expect(page.locator("#aufraeumenPanel")).toBeHidden();
});
