// ============================================================
// Einfaches Rate-Limit (In-Memory, pro Prozess)
// ============================================================

export function createLimiter({ max, windowMs }) {
  const hits = new Map();

  // Abgelaufene Einträge regelmäßig entfernen
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return {
    blocked(key) {
      const entry = hits.get(key);
      return !!entry && entry.resetAt > Date.now() && entry.count >= max;
    },
    hit(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count++;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
