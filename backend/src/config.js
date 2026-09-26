// ============================================================
// Configuration from environment variables
// ============================================================

// Throws if the configuration is insecure or incomplete
export function loadConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET;

  // Without a secure secret anyone could forge valid (admin) JWTs
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

    // Comma-separated list of allowed frontend origins.
    // Only needed if the frontend calls the API from a different origin.
    corsOrigins: (env.CORS_ORIGIN || "").split(",").map(o => o.trim()).filter(Boolean),

    // Registration is allowed by default; ALLOW_REGISTRATION=false disables it
    allowRegistration: env.ALLOW_REGISTRATION !== "false",

    // Needed behind reverse proxies so that req.ip is the real client IP
    trustProxy,

    // Reverse geocoding of GPS coordinates in the destination (Nominatim)
    geocoding: {
      enabled: env.GEOCODING !== "false",
      email:   env.NOMINATIM_EMAIL || null,
    },

    // Time zone in which months and years are evaluated
    timezone: "Europe/Berlin",
  };
}
