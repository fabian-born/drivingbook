// Erzeugt die Screenshots für docs/ (GitHub-Page, englisch) mit Demo-Daten (Vorjahr + laufendes Jahr)
import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { anmelden, api, loginImBrowser } from "../tests/helpers.js";
import { ADMIN_PASSWORD } from "../konstanten.js";

const OUT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/img");
const JAHR = new Date().getFullYear();

// Reproduzierbarer Zufall
let seed = 42;
const zufall = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const eins   = liste => liste[Math.floor(zufall() * liste.length)];

const KUNDEN = [
  ["Stadtwerke Augsburg", 72], ["Bechtle AG, Neckarsulm", 238], ["Sample Customer Ltd., Ingolstadt", 84],
  ["Trade fair Munich", 21], ["Siemens Healthineers, Erlangen", 176], ["Training Nuremberg", 168],
];
const PRIVAT = [["Groceries", 9], ["Gym", 14], ["Parents, Landshut", 76], ["Trip to Tegernsee", 62], ["Hardware store", 11]];
const BUERO  = "Office Munich";

async function demoFahrten(user, vehicle, bisTag) {
  let km = 31480;
  const post = (ts, destination, trip_type, strecke) => {
    km += strecke;
    return api("/api/trips", { method: "POST", token: user.token,
      body: { odometer_km: km, destination, trip_type, timestamp: ts.toISOString(), vehicle_code: vehicle.code } });
  };
  for (let d = new Date(Date.UTC(JAHR - 1, 0, 2, 6, 30)); d <= bisTag; d.setUTCDate(d.getUTCDate() + 1)) {
    const wt = d.getUTCDay();
    const tag = new Date(d);
    if (wt >= 1 && wt <= 5) {
      if (zufall() < 0.22) {
        const [ziel, weg] = eins(KUNDEN);
        tag.setUTCHours(6, 45 + Math.floor(zufall() * 30));
        await post(tag, ziel, "business", Math.round(weg * 2 * (0.95 + zufall() * 0.1)));
      } else if (zufall() < 0.55) {
        tag.setUTCHours(6, 20 + Math.floor(zufall() * 40));
        await post(tag, BUERO, "commute", 36 + Math.round(zufall() * 3));
      }
    } else if (zufall() < 0.45) {
      const [ziel, weg] = eins(PRIVAT);
      tag.setUTCHours(9 + Math.floor(zufall() * 6), 10);
      await post(tag, ziel, "private", Math.round(weg * 2 * (0.9 + zufall() * 0.2)));
    }
  }
}

test("Screenshots für die Projektseite", async ({ browser }) => {
  test.setTimeout(240_000);

  // ── Demo-Daten ─────────────────────────────────────────────
  const admin = await anmelden("admin", ADMIN_PASSWORD);
  const user  = { username: "demo", password: "demo-passwort" };
  await api("/api/users", { method: "POST", token: admin, body: user });
  user.token    = await anmelden(user.username, user.password);
  user.vehicles = [
    await api("/api/vehicles", { method: "POST", token: user.token, body: { name: "Audi A4 Avant", is_default: true } }),
    await api("/api/vehicles", { method: "POST", token: user.token, body: { name: "Tesla Model 3" } }),
  ];
  const [audi, tesla] = user.vehicles;
  const gestern = new Date(); gestern.setUTCDate(gestern.getUTCDate() - 1);
  await demoFahrten(user, audi, gestern);
  let teslaKm = 12030;
  for (const [i, [ziel, typ, strecke]] of [[BUERO, "commute", 37], ["Groceries", "private", 18], ["Sample Customer Ltd., Ingolstadt", "business", 168]].entries()) {
    teslaKm += strecke;
    await api("/api/trips", { method: "POST", token: user.token, body: {
      odometer_km: teslaKm, destination: ziel, trip_type: typ,
      timestamp: new Date(Date.UTC(JAHR, 7, 3 + i, 7)).toISOString(), vehicle_code: tesla.code } });
  }
  await api(`/api/vehicles/${audi.id}`, { method: "PATCH", token: user.token,
    body: { license_plate: "M-DB 2024", list_price: 54900, drive_type: "combustion" } });
  await api(`/api/vehicles/${audi.id}/years/${JAHR}`, { method: "PUT", token: user.token,
    body: { total_costs: 11800, depreciation: 6200, commute_km: 18, months: 12, tax_rate: 42 } });
  await api("/api/backup", { token: user.token });   // keine Sicherungs-Erinnerung auf den Bildern

  // ── Browser ────────────────────────────────────────────────
  async function seite({ mobil = false, dunkel = false } = {}) {
    const ctx = await browser.newContext({
      baseURL: "http://localhost:8099", locale: "en-GB", timezoneId: "Europe/Berlin",
      colorScheme: dunkel ? "dark" : "light",
      ...(mobil ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
                : { viewport: { width: 1280, height: 800 } }),
    });
    const page = await ctx.newPage();
    await loginImBrowser(page, user);
    return page;
  }
  async function foto(page, url, datei, { ganz = false, vorher } = {}) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    if (vorher) await vorher(page);
    await page.waitForTimeout(1200);   // Diagramm-Animationen
    await page.screenshot({ path: path.join(OUT, datei), fullPage: ganz });
  }

  const desktop = await seite();
  await foto(desktop, "/index.html",   "dashboard.png");
  await foto(desktop, "/view.html",    "trips.png");
  await foto(desktop, "/history.html", "yearly-history.png", { ganz: true });
  await foto(desktop, "/auto.html",    "vehicle-info.png", { ganz: true });
  await foto(desktop, "/profile.html", "account.png");

  const dunkel = await seite({ dunkel: true });
  await foto(dunkel, "/index.html", "dashboard-dark.png");

  const mobil = await seite({ mobil: true });
  await foto(mobil, "/driving.html", "new-trip-mobile.png");
  await foto(mobil, "/index.html",   "dashboard-mobile.png");

  expect(true).toBe(true);
});
