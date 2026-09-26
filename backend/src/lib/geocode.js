// ============================================================
// Reverse geocoding: GPS coordinates in the destination → address (Nominatim)
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/
// ============================================================

const TIMEOUT_MS = 5000;
const USER_AGENT = "Fahrtenbuch/2.0 (+https://github.com/fabian-born/drivingbook)";

// Recognizes formats like "(49.79948, 8.609279)" or "49.79948, 8.609279"
const COORDS = /^\(?\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\)?$/;

export function createGeocoder({ enabled, email }) {
  return async function resolveGpsToAddress(target) {
    const match = enabled && target.match(COORDS);
    if (!match) return target;  // Not a GPS format → unchanged

    const params = new URLSearchParams({
      lat: match[1], lon: match[2], format: "json", addressdetails: "1",
    });
    if (email) params.set("email", email);

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: { "User-Agent": USER_AGENT },
        signal:  AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return target;

      const data = await res.json();
      const addr = data.address || {};
      const street = [addr.road, addr.house_number].filter(Boolean).join(" ");
      const place     = [addr.postcode, addr.city || addr.town || addr.village].filter(Boolean).join(" ");
      const address = [street, place].filter(Boolean).join(", ");

      return address || data.display_name || target;
    } catch (err) {
      console.warn("Reverse Geocoding fehlgeschlagen:", err.message);
      return target;  // On error, keep the coordinates
    }
  };
}
