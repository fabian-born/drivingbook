import { test, expect } from "@playwright/test";
import { api, fahrt, loginImBrowser, neuerUser } from "./helpers.js";

test.describe("Englische Browsersprache", () => {
  test.use({ locale: "en-GB" });

  test("Oberfläche, Zahlen und Backend-Meldungen auf Englisch", async ({ page }) => {
    await page.goto("/login.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

    const user = await neuerUser(["Golf"]);
    await fahrt(user, { odometer_km: 12500, timestamp: new Date(Date.now() - 86400e3).toISOString() });
    await loginImBrowser(page, user);
    await expect(page.locator("#mainNav")).toContainText("New trip");

    await page.goto("/driving.html");
    await expect(page.locator("#lastReading")).toContainText("12,500 km");

    // km-Stand kleiner als zuvor → Rückfrage mit Meldung vom Backend auf Englisch
    const dialoge = [];
    page.on("dialog", d => { dialoge.push(d.message()); d.dismiss(); });
    await page.fill("#odometer", "12400");
    await page.fill("#destination", "Customer");
    await page.getByRole("button", { name: "Save trip" }).click();
    await expect.poll(() => dialoge.join("\n")).toMatch(/lower than on the previous trip/);
  });
});

test("Sprachwahl im Profil gilt nach dem Login auch auf anderen Geräten", async ({ page, context }) => {
  const user = await neuerUser(["Golf"]);
  await loginImBrowser(page, user);
  await page.goto("/profile.html");
  await expect(page.locator("#mainNav")).toContainText("Neue Fahrt");

  await page.selectOption("#profileLanguage", "en");
  await expect(page.locator("#mainNav")).toContainText("New trip");
  expect((await api("/api/profile", { token: user.token })).user.language).toBe("en");

  // „anderes Gerät“: ohne gespeicherte Einstellung, deutscher Browser → Sprache kommt vom Login
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto("/login.html");
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  await loginImBrowser(page, user);
  await expect(page.locator("#mainNav")).toContainText("New trip");

  // zurück auf „Automatisch“ → Browsersprache (Deutsch)
  await page.goto("/profile.html");
  await page.selectOption("#profileLanguage", "");
  await expect(page.locator("#mainNav")).toContainText("Neue Fahrt");
});
