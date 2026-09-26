// Setzt die Test-Datenbank zurück und startet Backend + Frontend-Server
import http from "http";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const root    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend", "package.json"));
const pg      = require("pg");

import { ADMIN_PASSWORD } from "./konstanten.js";
const BACKEND_PORT  = 3999;
const FRONTEND_PORT = 8099;

const db = {
  host:     process.env.DB_HOST     || "127.0.0.1",
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "fahrtenbuch_test",
  user:     process.env.DB_USER     || "fahrtenbuch",
  password: process.env.DB_PASSWORD || "test",
};

// Schutz: das Schema wird komplett gelöscht – nur gegen eine Testdatenbank laufen
if (!/test/i.test(db.database)) {
  console.error(`❌ DB_NAME "${db.database}" sieht nicht nach einer Testdatenbank aus (muss "test" enthalten) – Abbruch.`);
  process.exit(1);
}

const client = new pg.Client(db);
await client.connect();
await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await client.end();

const backend = spawn("node", ["server.js"], {
  cwd: path.join(root, "backend"),
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(BACKEND_PORT),
    DB_HOST: db.host, DB_PORT: String(db.port), DB_NAME: db.database, DB_USER: db.user, DB_PASSWORD: db.password,
    JWT_SECRET: "e2e-secret-".padEnd(48, "x"),
    ADMIN_PASSWORD,
    GEOCODING: "false",
  },
});
backend.on("exit", code => process.exit(code ?? 1));

// Statisches Frontend wie im nginx-Container: /api → Backend
const TYPES = {
  ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".ver": "text/plain", ".webmanifest": "application/manifest+json",
};
const frontend = path.join(root, "frontend");
http.createServer((req, res) => {
  if (req.url.startsWith("/api")) {
    const proxy = http.request(
      { host: "127.0.0.1", port: BACKEND_PORT, path: req.url, method: req.method, headers: req.headers },
      r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
    );
    proxy.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(proxy);
    return;
  }
  const datei = path.join(frontend, path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^\/$/, "/index.html"));
  if (!datei.startsWith(frontend)) { res.writeHead(403); return res.end(); }
  fs.readFile(datei, (err, inhalt) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(datei)] || "application/octet-stream" });
    res.end(inhalt);
  });
}).listen(FRONTEND_PORT);

const beenden = () => { backend.kill(); process.exit(0); };
process.on("SIGTERM", beenden);
process.on("SIGINT", beenden);
