import { test, expect } from "@playwright/test";
import { fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

const thema = page => page.locator("html").getAttribute("data-bs-theme");
const diagrammFarben = page => page.evaluate(() =>
  Chart.getChart(document.querySelector("canvas")).data.datasets.map(d => d.backgroundColor));

test.describe("Hell-/Dunkelmodus", () => {
  test.use({ colorScheme: "dark" });

  test("folgt dem System, lässt sich umstellen und merkt sich die Wahl", async ({ page }) => {
    const user = await neuerUser();
    await fahrt(user, { odometer_km: 100, timestamp: `${jahr}-01-05T08:00:00Z` });
    await fahrt(user, { odometer_km: 150, timestamp: `${jahr}-01-06T08:00:00Z`, trip_type: "commute" });

    // schon die Login-Seite ist dunkel (kein helles Aufblitzen)
    await page.goto("/login.html");
    expect(await thema(page)).toBe("dark");

    await loginImBrowser(page, user);
    await expect(page.locator("canvas")).toBeVisible();
    expect(await diagrammFarben(page)).toEqual(["#3d8bfd", "#20a36a", "#cc7e00"]);

    // System wechselt auf hell → automatisch mit
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => thema(page)).toBe("light");
    expect(await diagrammFarben(page)).toEqual(["#0d6efd", "#198754", "#e08a00"]);

    // manuell „Dunkel“ – gilt auch nach dem Neuladen, obwohl das System hell ist
    await page.getByRole("button", { name: "Profil" }).click();
    await page.locator("[data-theme=dunkel]").click();
    expect(await thema(page)).toBe("dark");
    await page.reload();
    expect(await thema(page)).toBe("dark");
    await page.getByRole("button", { name: "Profil" }).click();
    await expect(page.locator("[data-theme=dunkel]")).toHaveAttribute("aria-checked", "true");

    // zurück auf „Automatisch“
    await page.locator("[data-theme=auto]").click();
    expect(await thema(page)).toBe("light");
  });

  test("Drucken erfolgt immer hell", async ({ page }) => {
    const user = await neuerUser();
    await fahrt(user, { odometer_km: 100, timestamp: `${jahr - 1}-03-05T08:00:00Z` });
    await fahrt(user, { odometer_km: 180, timestamp: `${jahr - 1}-03-06T08:00:00Z` });
    await loginImBrowser(page, user);
    await page.goto("/history.html");
    await expect(page.locator("canvas")).toBeVisible();
    expect(await thema(page)).toBe("dark");

    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    expect(await thema(page)).toBe("light");
    await expect(page.locator(".history-print")).toHaveAttribute("src", /^data:image\/png/);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    expect(await thema(page)).toBe("dark");
  });
});
