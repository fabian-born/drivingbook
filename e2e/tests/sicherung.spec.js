import { test, expect } from "@playwright/test";
import fs from "fs";
import { api, fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

async function lade(page, testInfo, klick) {
  const [download] = await Promise.all([page.waitForEvent("download"), klick()]);
  const datei = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(datei);
  return datei;
}

test("Fahrzeug sichern, löschen und mit gleichem Code wiederherstellen", async ({ page }, testInfo) => {
  const user = await neuerUser(["Passat", "Polo"]);
  const [passat] = user.vehicles;
  const r = await fahrt(user, { kmstand: 500, ziel: "Kunde X", fahrtart: "geschäftlich", timestamp: `${jahr}-02-01T08:00:00Z`, vehicle_code: passat.code });
  await fahrt(user, { kmstand: 560, ziel: "Heim", timestamp: `${jahr}-02-02T08:00:00Z`, vehicle_code: passat.code });
  await api(`/api/fahrt/${r.id}`, { method: "PUT", token: user.token, body: { ziel: "Kunde X GmbH" } });

  await loginImBrowser(page, user);   // Passat aktiv
  await page.goto("/auto.html");
  const datei = await lade(page, testInfo, () => page.click("#exportBtn"));
  expect(JSON.parse(fs.readFileSync(datei, "utf8")).fahrten).toHaveLength(2);

  // Fahrzeug löschen → Polo wird aktiv
  page.on("dialog", d => d.accept());
  await Promise.all([page.waitForEvent("load"), page.locator("#vehicleTabelle tr", { hasText: "Passat" }).locator(".delete-vehicle-btn").click()]);
  await expect(page.locator("#autoName")).toHaveText("Polo");

  await page.setInputFiles("#importDatei", datei);
  await Promise.all([page.waitForEvent("load"), page.click("#importBtn")]);
  await expect(page.locator("#autoName")).toHaveText("Passat");
  await expect(page.locator("#autoCode")).toHaveText(passat.code);

  await page.goto("/view.html");
  await page.selectOption("#jahrSelect", String(jahr));
  await page.selectOption("#monatSelect", "02");
  await expect(page.locator("#fahrtenTabelle [data-field=ziel]")).toHaveText(["Kunde X GmbH", "Heim"]);
  await page.locator("#fahrtenTabelle .history-btn").click();
  await expect(page.locator("#auditModalBody li")).toHaveCount(2);
  await expect(page.locator("#auditModalBody")).not.toContainText("importiert");

  // Nochmal einspielen: nichts Doppeltes
  await page.goto("/auto.html");
  await page.setInputFiles("#importDatei", datei);
  await page.click("#importBtn");
  await expect(page.locator("#importAlert")).toContainText("0 Fahrt(en) ergänzt, 2 bereits vorhanden");
});

test("Gesamtsicherung im Konto, Erinnerung auf dem Dashboard", async ({ page }, testInfo) => {
  const user = await neuerUser(["Golf", "Tesla"]);
  await fahrt(user, { kmstand: 100, timestamp: `${jahr}-01-10T08:00:00Z`, vehicle_code: user.vehicles[0].code });
  await fahrt(user, { kmstand: 50,  timestamp: `${jahr}-01-11T08:00:00Z`, vehicle_code: user.vehicles[1].code });

  // Neue Fahrzeuge: noch nicht fällig
  await loginImBrowser(page, user);
  await expect(page.locator("#monatsTabelle tr")).toHaveCount(1);
  await expect(page.locator("#sicherungHinweis")).toBeHidden();

  // Fahrzeuge „alt“ machen → Erinnerung
  await page.route("**/api/backup/status", async route => {
    const res  = await route.fetch();
    const json = await res.json();
    json.fahrzeuge = json.fahrzeuge.map(v => ({ ...v, erinnern: v.aenderungen > 0 }));
    await route.fulfill({ response: res, json });
  });
  await page.reload();
  await expect(page.locator("#sicherungHinweis")).toBeVisible();
  await expect(page.locator("#sicherungHinweisText")).toHaveText("Deine Fahrten wurden noch nie gesichert.");

  await page.goto("/profile.html");
  await expect(page.locator("#sicherungTabelle tr")).toHaveText([/Golf\s+noch nie/, /Tesla\s+noch nie/]);
  const datei = await lade(page, testInfo, () => page.click("#sichernBtn"));
  const sicherung = JSON.parse(fs.readFileSync(datei, "utf8"));
  expect(sicherung.format).toBe("drivingbook-sicherung");
  expect(sicherung.fahrzeuge.map(f => f.fahrzeug.name)).toEqual(["Golf", "Tesla"]);
  await expect(page.locator("#sicherungTabelle tr").first()).not.toContainText("noch nie");

  await page.goto("/index.html");
  await expect(page.locator("#monatsTabelle tr")).toHaveCount(1);
  await expect(page.locator("#sicherungHinweis")).toBeHidden();

  page.on("dialog", d => d.accept());
  await page.goto("/profile.html");
  await page.setInputFiles("#wiederherstellenDatei", datei);
  await page.click("#wiederherstellenBtn");
  await expect(page.locator("#sicherungAlert")).toContainText("Golf: 0 Fahrt(en) ergänzt, 1 bereits vorhanden");
  await expect(page.locator("#sicherungAlert")).toContainText("Tesla: 0 Fahrt(en) ergänzt, 1 bereits vorhanden");
});
