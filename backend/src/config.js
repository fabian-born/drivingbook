// ============================================================
// Konfiguration aus Umgebungsvariablen
// ============================================================

// Wirft einen Fehler, wenn die Konfiguration unsicher oder unvollständig ist
export function loadConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET;

  // Ohne sicheres Secret könnte jeder gültige (Admin-)JWTs fälschen
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.includes("CHANGE_ME")) {
    throw new Error(
      "JWT_SECRET fehlt oder ist unsicher (mind. 32 zufällige Zeichen erforderlich).\n" +
      "   Generieren mit: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  let trustProxy = false;
  if (env.TRUST_PROXY) {
    const hops = Number(env.TRUST_PROXY);
    trustProxy = Number.isInteger(hops) ? hops : env.TRUST_PROXY;
  }

  return {
    port:       Number(env.PORT) || 3000,
    jwtSecret,
    jwtExpires: env.JWT_EXPIRES || "8h",

    db: {
      host:     env.DB_HOST     || "db",
      port:     Number(env.DB_PORT) || 5432,
      database: env.DB_NAME     || "fahrtenbuch",
      user:     env.DB_USER     || "fahrtenbuch",
      password: env.DB_PASSWORD || "fahrtenbuch",
    },

    admin: {
      username: env.ADMIN_USERNAME?.trim().toLowerCase() || "admin",
      password: env.ADMIN_PASSWORD || null,
    },

    // Kommagetrennte Liste erlaubter Frontend-Origins.
    // Nur nötig, wenn das Frontend die API von einer anderen Origin aufruft.
    corsOrigins: (env.CORS_ORIGIN || "").split(",").map(o => o.trim()).filter(Boolean),

    // Registrierung ist standardmäßig erlaubt; ALLOW_REGISTRATION=false schaltet sie ab
    allowRegistration: env.ALLOW_REGISTRATION !== "false",

    // Hinter Reverse-Proxys nötig, damit req.ip die echte Client-IP ist
    trustProxy,

    // Reverse-Geocoding von GPS-Koordinaten im Ziel (Nominatim)
    geocoding: {
      enabled: env.GEOCODING !== "false",
      email:   env.NOMINATIM_EMAIL || null,
    },

    // Zeitzone, in der Monate und Jahre ausgewertet werden
    timezone: "Europe/Berlin",
  };
}
