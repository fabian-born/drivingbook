import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const frontend = path.resolve(import.meta.dirname, "../../frontend");
const lies = datei => fs.readFileSync(path.join(frontend, datei), "utf8");

test("alle eigenen Seiten und Skripte sind offline verfügbar (APP_SHELL)", () => {
  const sw = lies("sw.js");
  const appShell = JSON.parse(sw.match(/const APP_SHELL = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));

  const seiten   = fs.readdirSync(frontend).filter(d => d.endsWith(".html"));
  const skripte  = seiten.flatMap(s => [...lies(s).matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]));
  const fehlend  = [...new Set([...seiten, ...skripte])].filter(d => !appShell.includes(d));
  expect(fehlend).toEqual([]);

  for (const datei of appShell.filter(d => d !== "./")) {
    expect(fs.existsSync(path.join(frontend, datei)), `${datei} existiert`).toBe(true);
  }
});

test("Service-Worker-Cache trägt die Frontend-Version", () => {
  const version = lies("release.ver").trim();
  expect(lies("sw.js")).toContain(`const CACHE = "fahrtenbuch-${version}";`);
});

test("Manifest ist gültig", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  const manifest = await res.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some(i => i.sizes === "512x512")).toBe(true);
});
