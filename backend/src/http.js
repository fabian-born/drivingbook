// ============================================================
// HTTP-Hilfen: Fehlerklasse, Async-Wrapper, Validierung,
// zentrale Fehlerbehandlung
// ============================================================

// Fehler mit HTTP-Status; `extra` wird mit in die JSON-Antwort übernommen
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra  = extra;
  }
}

// Express 4 fängt abgelehnte Promises nicht selbst ab
export const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Prüft `data` gegen ein zod-Schema; wirft bei Fehlern 400 mit der ersten Meldung
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0].message);
  }
  return result.data;
}

// Muss als letzte Middleware registriert werden
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Ungültiges JSON im Request-Body" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request-Body zu groß" });
  }

  console.error(`Fehler bei ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ error: "Interner Fehler" });
}
