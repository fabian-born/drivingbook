import { test, expect } from "@playwright/test";
import fs from "fs";
import { api, fahrt, jahr, loginImBrowser, neuerUser } from "./helpers.js";

test("Fahrzeug exportieren und bei einem anderen User importieren", async ({ page }, testInfo) => {
  const quelle = await neuerUser(["Passat"]);
  const r = await fahrt(quelle, { kmstand: 500, ziel: "Kunde X", fahrtart: "geschäftlich", timestamp: `${jahr}-02-01T08:00:00Z` });
  await fahrt(quelle, { kmstand: 560, ziel: "Heim", timestamp: `${jahr}-02-02T08:00:00Z` });
  await api(`/api/fahrt/${r.id}`, { method: "PUT", token: quelle.token, body: { ziel: "Kunde X GmbH" } });

  await loginImBrowser(page, quelle);
  await page.goto("/auto.html");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
  const datei = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(datei);
  expect(JSON.parse(fs.readFileSync(datei, "utf8")).fahrten).toHaveLength(2);

  const ziel = await neuerUser(["Polo"]);
  await page.click("#logoutBtn");
  await loginImBrowser(page, ziel);
  await page.goto("/auto.html");
  page.on("dialog", d => d.accept());
  await page.setInputFiles("#importDatei", datei);
  await Promise.all([page.waitForEvent("load"), page.click("#importBtn")]);

  await expect(page.locator("#autoName")).toHaveText("Passat");
  await page.goto("/view.html");
  await page.selectOption("#jahrSelect", String(jahr));
  await page.selectOption("#monatSelect", "02");
  await expect(page.locator("#fahrtenTabelle [data-field=ziel]")).toHaveText(["Kunde X GmbH", "Heim"]);
  await page.locator("#fahrtenTabelle .history-btn").click();
  await expect(page.locator("#auditModalBody li")).toHaveCount(2);
  await expect(page.locator("#auditModalBody")).toContainText("Web (importiert)");

  // Zweiter Import ins selbe Fahrzeug überspringt alles
  await page.goto("/auto.html");
  await page.setInputFiles("#importDatei", datei);
  await page.check("#importZusammen");
  await page.click("#importBtn");
  await expect(page.locator("#importAlert")).toContainText("0 Fahrten importiert, 2 bereits vorhanden");
});
