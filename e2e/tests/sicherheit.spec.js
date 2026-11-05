// Sicherheits-Header und Content-Security-Policy des nginx-Frontends.
// Nur im Docker-Modus (E2E_DOCKER=1): lokal liefert start.mjs die Dateien
// ohne nginx und damit ohne diese Header aus.
import { test, expect } from "@playwright/test";
import { ADMIN_PASSWORD } from "../konstanten.js";
import { anmelden, neuerUser, fahrt, jahr } from "./helpers.js";

test.skip(!process.env.E2E_DOCKER, "nur gegen das nginx-Image (E2E_DOCKER=1)");

const SEITEN = ["index.html", "driving.html", "view.html", "history.html", "profile.html",
  "auto.html", "admin.html", "login.html", "register.html"];

test("nginx setzt die Sicherheits-Header – auch bei eigenen Cache-Headern", async ({ request }) => {
  for (const pfad of ["/", "/index.html", "/js/config.js", "/icons/icon-192.png", "/manifest.webmanifest", "/release.ver", "/api/health"]) {
    const res = await request.get(pfad);
    const h = res.headers();
    expect(h["content-security-policy"], pfad).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"], pfad).toBe("nosniff");
    expect(h["x-frame-options"], pfad).toBe("DENY");
    expect(h["referrer-policy"], pfad).toBe("same-origin");
  }
});

test("keine Seite verstößt gegen die Content-Security-Policy", async ({ page }) => {
  const user  = await neuerUser(["Golf"], { prefix: "csp" });
  await fahrt(user, { odometer_km: 1000, timestamp: `${jahr - 1}-06-01T08:00:00Z`, vehicle_code: user.vehicles[0].code });
  const admin = await anmelden("admin", ADMIN_PASSWORD);

  const verstoesse = [];
  page.on("console", m => { if (/Content Security Policy/i.test(m.text())) verstoesse.push(m.text()); });
  page.on("pageerror", e => verstoesse.push(`pageerror: ${e.message}`));

  for (const seite of SEITEN) {
    // admin.html nur für Admins, die übrigen mit einem normalen User
    const token = seite === "admin.html" ? admin : user.token;
    await page.goto("/login.html");
    await page.evaluate(t => localStorage.setItem("authToken", t), token);
    await page.goto(`/${seite}`);
    await page.waitForLoadState("networkidle");
  }
  expect(verstoesse).toEqual([]);
});

test("nginx nimmt große Sicherungen an (über 1 MB)", async ({ request }) => {
  const user = await neuerUser(["Golf"], { prefix: "gross" });
  const res = await request.post("/api/backup/restore", {
    headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
    data: JSON.stringify({ format: "ungueltig", fuellung: "x".repeat(2 * 1024 * 1024) }),
  });
  // Das Backend lehnt den Inhalt ab – entscheidend ist, dass nginx nicht mit 413 abbricht
  expect(res.status()).not.toBe(413);
  expect(res.status()).toBe(400);
});
