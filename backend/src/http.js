// ============================================================
// HTTP helpers: error class, async wrapper, validation,
// central error handling
// ============================================================

// Error with HTTP status. `message` is a translation key (src/lang/*.json)
// or a literal text; `params` fill its placeholders; `extra` is merged
// into the JSON response
import { languageFrom, translate } from "./i18n.js";

export class HttpError extends Error {
  constructor(status, message, extra = {}, params = {}) {
    super(message);
    this.status = status;
    this.extra  = extra;
    this.params = params;
  }
}

// Express 4 does not catch rejected promises by itself
export const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Validates `data` against a zod schema; on failure throws 400 with the first message
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    // Limits and allowed values for the placeholders of the message
    throw new HttpError(400, issue.message, {}, {
      maximum: issue.maximum, minimum: issue.minimum, values: issue.values?.join(", "),
    });
  }
  return result.data;
}

// Must be registered as the last middleware
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: translate(languageFrom(req), err.message, err.params), ...err.extra });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: translate(languageFrom(req), "errors.invalidJson") });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: translate(languageFrom(req), "errors.bodyTooLarge") });
  }

  console.error(`Fehler bei ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ error: translate(languageFrom(req), "errors.internal") });
}
