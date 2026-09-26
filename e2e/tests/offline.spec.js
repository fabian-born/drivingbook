import { test, expect } from "@playwright/test";
import { api, loginImBrowser, neuerUser } from "./helpers.js";

test("offline erfasste Fahrt wird nachgereicht, sobald wieder Netz da ist", async ({ page, context }) => {
  const user = await neuerUser();
  await loginImBrowser(page, user);
  await page.goto("/driving.html");
  await expect(page.locator("#fahrzeugName")).toHaveText("Golf");

  await context.setOffline(true);
  await page.fill("#kmstand", "4321");
  await page.fill("#ziel", "Offline-Ziel");
  await page.getByRole("button", { name: "Fahrt speichern" }).click();
  await expect(page.locator("#statusMeldung")).toHaveClass(/alert-warning/);
  await expect(page.locator("#warteschlangeNav")).toHaveText(/1 wartend/);

  await context.setOffline(false);
  await expect(page.locator("#warteschlangeNav")).toBeHidden();
  await expect(page.locator("#statusMeldung")).toContainText("nachträglich gespeichert");

  const jahr = new Date().getFullYear();
  const daten = await api(`/api/fahrten?year=${jahr}&vehicle=${user.vehicles[0].code}`, { token: user.token });
  expect(daten.fahrten.map(f => f.ziel)).toEqual(["Offline-Ziel"]);
});

test("wartende Fahrten gehen nach Benutzerwechsel nicht an das falsche Konto", async ({ page, context }) => {
  const erster  = await neuerUser();
  const zweiter = await neuerUser();
  await loginImBrowser(page, erster);
  await page.goto("/driving.html");
  await expect(page.locator("#fahrzeugName")).toHaveText("Golf");

  await context.setOffline(true);
  await page.fill("#kmstand", "100");
  await page.fill("#ziel", "Gehört dem Ersten");
  await page.getByRole("button", { name: "Fahrt speichern" }).click();
  await context.setOffline(false);
  await page.evaluate(() => localStorage.setItem("authToken", "abgelaufen"));

  await loginImBrowser(page, zweiter);
  await expect(page.locator("#warteschlangeNav")).toBeHidden();
  const jahr = new Date().getFullYear();
  expect((await api(`/api/fahrten?year=${jahr}`, { token: zweiter.token })).fahrten).toEqual([]);

  await page.click("#logoutBtn");
  await loginImBrowser(page, erster);
  await expect.poll(async () =>
    (await api(`/api/fahrten?year=${jahr}`, { token: erster.token })).fahrten.map(f => f.ziel)
  ).toEqual(["Gehört dem Ersten"]);
});
