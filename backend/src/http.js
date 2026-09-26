// ============================================================
// HTTP helpers: error class, async wrapper, validation,
// central error handling
// ============================================================

// Error with HTTP status; `extra` is merged into the JSON response
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra  = extra;
  }
}

// Express 4 does not catch rejected promises by itself
export const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Validates `data` against a zod schema; on failure throws 400 with the first message
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0].message);
  }
  return result.data;
}

// Must be registered as the last middleware
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
