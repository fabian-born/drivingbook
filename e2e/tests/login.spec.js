import { test, expect } from "@playwright/test";
import { loginImBrowser, neuerUser } from "./helpers.js";
import { ADMIN_PASSWORD } from "../konstanten.js";

test("Login unabhängig von Groß-/Kleinschreibung, Fahrzeugwahl bei mehreren Autos", async ({ page }) => {
  const user = await neuerUser(["Golf", "Tesla"]);
  await page.goto("/login.html");
  await page.fill("#username", user.username.toUpperCase());
  await page.fill("#password", user.password);
  await page.click("button[type=submit]");

  await expect(page.locator("#fahrzeugWahl")).toBeVisible();
  await expect(page.locator("#fahrzeugListe button")).toHaveText([/Golf \(Standard\)/, /Tesla/]);
  await page.locator("#fahrzeugListe button", { hasText: "Tesla" }).click();

  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator("#fahrzeugKontext option:checked")).toHaveText(/Tesla/);
});

test("Admin-Eintrag im Profil-Menü nur für Admins", async ({ page }) => {
  const user = await neuerUser();
  await loginImBrowser(page, user);
  await page.getByRole("button", { name: "Profil" }).click();
  await expect(page.locator(".dropdown-menu .dropdown-item:visible")).toHaveText(["Konto", "Auto-Info"]);

  await page.click("#logoutBtn");
  await loginImBrowser(page, { username: "admin", password: ADMIN_PASSWORD, vehicles: [{}] });
  await page.getByRole("button", { name: "Profil" }).click();
  await expect(page.locator(".dropdown-menu .dropdown-item:visible")).toHaveText(["Konto", "Auto-Info", "Admin"]);
});

test("aktive Seite ist im Menü markiert, auch im Dropdown", async ({ page }) => {
  const user = await neuerUser();
  await loginImBrowser(page, user);
  await page.goto("/auto.html");
  await expect(page.locator(".navbar .active")).toHaveText(["Profil", "Auto-Info"]);
});
