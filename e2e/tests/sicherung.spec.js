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
  const r = await fahrt(user, { odometer_km: 500, destination: "Kunde X", trip_type: "business", timestamp: `${jahr}-02-01T08:00:00Z`, vehicle_code: passat.code });
  await fahrt(user, { odometer_km: 560, destination: "Heim", timestamp: `${jahr}-02-02T08:00:00Z`, vehicle_code: passat.code });
  await api(`/api/trips/${r.id}`, { method: "PUT", token: user.token, body: { destination: "Kunde X GmbH" } });

  await loginImBrowser(page, user);   // Passat aktiv
  await page.goto("/auto.html");
  const datei = await lade(page, testInfo, () => page.click("#exportBtn"));
  expect(JSON.parse(fs.readFileSync(datei, "utf8")).trips).toHaveLength(2);

  // Fahrzeug löschen: die Fahrten ziehen in den Polo um (Dialog), Polo wird aktiv
  page.on("dialog", d => d.accept());
  await page.locator("#vehicleTabelle tr", { hasText: "Passat" }).locator(".delete-vehicle-btn").click();
  await expect(page.locator("#loeschenModal")).toBeVisible();
  await expect(page.locator("#loeschenText")).toContainText("2 Fahrten");
  await Promise.all([page.waitForEvent("load"), page.click("#loeschenBestaetigen")]);
  await expect(page.locator("#autoName")).toHaveText("Polo");
  await expect(page.locator("#kzFahrten")).toHaveText("2");

  // Sicherung einspielen: Passat kommt mit gleichem Code zurück, die Fahrten
  // sind schon im Polo vorhanden und werden nicht doppelt angelegt
  await page.setInputFiles("#importDatei", datei);
  await Promise.all([page.waitForEvent("load"), page.click("#importBtn")]);
  await expect(page.locator("#autoName")).toHaveText("Passat");
  await expect(page.locator("#autoCode")).toHaveText(passat.code);
  await expect(page.locator("#kzFahrten")).toHaveText("0");

  // Verlauf der umgezogenen Fahrt ist vollständig
  await Promise.all([page.waitForEvent("load"), page.selectOption("#fahrzeugKontext", { label: "🚗 Polo" })]);
  await page.goto("/view.html");
  await page.selectOption("#jahrSelect", String(jahr));
  await page.selectOption("#monatSelect", "02");
  await expect(page.locator("#fahrtenTabelle [data-field=destination]")).toHaveText(["Kunde X GmbH", "Heim"]);
  await page.locator("#fahrtenTabelle .history-btn").first().click();
  await expect(page.locator("#auditModalBody li")).toHaveCount(3);   // angelegt, geändert, umgezogen

  // Nochmal einspielen (Polo aktiv → App wechselt zum Passat): nichts Doppeltes
  let meldungen = "";
  page.on("dialog", d => { meldungen += d.message(); });
  await page.goto("/auto.html");
  await page.setInputFiles("#importDatei", datei);
  await Promise.all([page.waitForEvent("load"), page.click("#importBtn")]);
  expect(meldungen).toContain("0 Fahrten ergänzt, 2 bereits vorhanden");
});

test("Gesamtsicherung im Konto, Erinnerung auf dem Dashboard", async ({ page }, testInfo) => {
  const user = await neuerUser(["Golf", "Tesla"]);
  await fahrt(user, { odometer_km: 100, timestamp: `${jahr}-01-10T08:00:00Z`, vehicle_code: user.vehicles[0].code });
  await fahrt(user, { odometer_km: 50,  timestamp: `${jahr}-01-11T08:00:00Z`, vehicle_code: user.vehicles[1].code });

  // Neue Fahrzeuge: noch nicht fällig
  await loginImBrowser(page, user);
  await expect(page.locator(".monats-tabelle tbody tr")).toHaveCount(1);
  await expect(page.locator("#sicherungHinweis")).toBeHidden();

  // Fahrzeuge „alt“ machen → Erinnerung
  await page.route("**/api/backup/status", async route => {
    const res  = await route.fetch();
    const json = await res.json();
    json.vehicles = json.vehicles.map(v => ({ ...v, remind: v.changes > 0 }));
    await route.fulfill({ response: res, json });
  });
  await page.reload();
  await expect(page.locator("#sicherungHinweis")).toBeVisible();
  await expect(page.locator("#sicherungHinweisText")).toHaveText("Deine Fahrten wurden noch nie gesichert.");

  await page.goto("/profile.html");
  await expect(page.locator("#sicherungTabelle tr")).toHaveText([/Golf\s+noch nie/, /Tesla\s+noch nie/]);
  await expect(page.locator("#profileCountry")).toHaveText("Deutschland");
  const datei = await lade(page, testInfo, () => page.click("#sichernBtn"));
  const sicherung = JSON.parse(fs.readFileSync(datei, "utf8"));
  expect(sicherung.format).toBe("drivingbook-backup");
  expect(sicherung.vehicles.map(f => f.vehicle.name)).toEqual(["Golf", "Tesla"]);
  await expect(page.locator("#sicherungTabelle tr").first()).not.toContainText("noch nie");

  await page.goto("/index.html");
  await expect(page.locator(".monats-tabelle tbody tr")).toHaveCount(1);
  await expect(page.locator("#sicherungHinweis")).toBeHidden();

  page.on("dialog", d => d.accept());
  await page.goto("/profile.html");
  await page.setInputFiles("#wiederherstellenDatei", datei);
  await page.click("#wiederherstellenBtn");
  await expect(page.locator("#sicherungAlert")).toContainText("Golf: 0 Fahrten ergänzt, 1 bereits vorhanden");
  await expect(page.locator("#sicherungAlert")).toContainText("Tesla: 0 Fahrten ergänzt, 1 bereits vorhanden");
});
