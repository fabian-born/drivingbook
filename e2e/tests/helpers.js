// Hilfen: Testdaten über die API anlegen, im Browser anmelden
import { expect } from "@playwright/test";
import { ADMIN_PASSWORD } from "../konstanten.js";

const BASE = "http://localhost:8099";
let zaehler = 0;

export async function api(pfad, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + pfad, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let daten;
  try { daten = JSON.parse(text); } catch { daten = text; }
  if (!res.ok) throw new Error(`${method} ${pfad} → ${res.status}: ${text}`);
  return daten;
}

export async function anmelden(username, password) {
  return (await api("/api/login", { method: "POST", body: { username, password } })).token;
}

// Legt über die Admin-API einen User mit Fahrzeugen an (Registrierung ist ratenbegrenzt)
export async function neuerUser(fahrzeuge = ["Golf"], { prefix = "user" } = {}) {
  const admin    = await anmelden("admin", ADMIN_PASSWORD);
  const username = `${prefix}${Date.now() % 100000}${zaehler++}`;
  const password = "passwort123";
  await api("/api/users", { method: "POST", token: admin, body: { username, password } });

  const token    = await anmelden(username, password);
  const vehicles = [];
  for (const [i, name] of fahrzeuge.entries()) {
    vehicles.push(await api("/api/vehicles", { method: "POST", token, body: { name, is_default: i === 0 } }));
  }
  return { username, password, token, vehicles };
}

export async function fahrt(user, daten) {
  return api("/api/trips", { method: "POST", token: user.token, body: { destination: "Ziel", trip_type: "private", ...daten } });
}

// Anmeldung im Browser; bei mehreren Fahrzeugen das erste wählen
export async function loginImBrowser(page, user, username = user.username) {
  await page.goto("/login.html");
  await page.fill("#username", username);
  await page.fill("#password", user.password);
  await page.click("button[type=submit]");
  if (user.vehicles.length > 1) {
    await page.locator("#vehicleList button").first().click();
  }
  await expect(page).toHaveURL(/index\.html/);
}

export const jahr = new Date().getFullYear();
