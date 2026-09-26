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
  const daten = await api(`/api/trips?year=${jahr}&vehicle=${user.vehicles[0].code}`, { token: user.token });
  expect(daten.trips.map(f => f.destination)).toEqual(["Offline-Ziel"]);
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
  expect((await api(`/api/trips?year=${jahr}`, { token: zweiter.token })).trips).toEqual([]);

  await page.click("#logoutBtn");
  await loginImBrowser(page, erster);
  // Nachreichen läuft im Hintergrund – im vollen Testlauf kann das dauern
  await expect.poll(async () =>
    (await api(`/api/trips?year=${jahr}`, { token: erster.token })).trips.map(f => f.destination),
  { timeout: 15_000 }).toEqual(["Gehört dem Ersten"]);
});

test("eine fehlerhafte Offline-Fahrt blockiert die übrigen nicht und lässt sich verwerfen", async ({ page, context }) => {
  const user = await neuerUser(["Golf", "Zweitwagen"]);
  await loginImBrowser(page, user);            // Golf aktiv
  await page.goto("/driving.html");
  await expect(page.locator("#fahrzeugName")).toHaveText("Golf");

  await context.setOffline(true);
  for (const [km, ziel] of [["100", "Erste"], ["120", "Zweite"]]) {
    await page.fill("#kmstand", km);
    await page.fill("#ziel", ziel);
    await page.getByRole("button", { name: "Fahrt speichern" }).click();
    await expect(page.locator("#statusMeldung")).toHaveClass(/alert-warning/);
  }
  // die erste Fahrt kann nicht mehr gespeichert werden (Fahrzeug-Code ungültig)
  await page.evaluate(() => {
    const liste = JSON.parse(localStorage.getItem("offlineFahrten"));
    liste[0].vehicle_code = "ZZZZZZ";
    localStorage.setItem("offlineFahrten", JSON.stringify(liste));
  });

  await context.setOffline(false);
  await expect(page.locator("#offlineFehler")).toBeVisible();
  await expect(page.locator("#offlineFehlerListe li")).toHaveCount(1);
  await expect(page.locator("#offlineFehlerListe")).toContainText("Erste");
  await expect(page.locator("#offlineFehlerListe")).toContainText("Fahrzeug-Code nicht gefunden");
  await expect(page.locator("#warteschlangeNav")).toHaveText("⚠️ 1 fehlerhaft");

  // die zweite ist trotzdem angekommen
  const jahr = new Date().getFullYear();
  await expect.poll(async () =>
    (await api(`/api/trips?year=${jahr}&vehicle=${user.vehicles[0].code}`, { token: user.token })).trips.map(f => f.destination)
  ).toEqual(["Zweite"]);

  page.on("dialog", d => d.accept());
  await page.getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.locator("#offlineFehler")).toBeHidden();
  await expect(page.locator("#warteschlangeNav")).toBeHidden();
});
