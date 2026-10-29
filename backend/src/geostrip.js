// Routing map strip — display-only geography for routing cities.
// Coordinates come ONLY from the existing Nominatim lookup (osm.js) for
// city names the user entered as routing candidates plus the base city.
// They are NEVER fed into ranking, filtering, or break-even, and they are
// NEVER guessed: a city that does not resolve is omitted and labelled,
// never placed. Artist names and audience-area names are never sent here —
// only routing candidate city strings and the base city string.
// Successes are cached in-process (restart clears); failures are NOT cached,
// so a later render re-attempts them. Nominatim's 1-request-per-second
// usage rule is honored by osm.js serialization.
import { geocode } from './osm.js';
import { invalidInput } from './errors.js';

const cache = new Map(); // normalized city -> { displayName, lat, lon }

export function clearGeocodeCache() {
  cache.clear();
}

function normalize(city) {
  return city.trim().toLowerCase();
}

export async function geocodeCities(cities, { fetchImpl = fetch, baseUrl } = {}) {
  if (!Array.isArray(cities)) throw invalidInput('cities must be an array of 1–11 city strings');
  if (cities.length < 1 || cities.length > 11) throw invalidInput('cities must contain 1–11 city strings');
  const seen = new Set();
  const ordered = [];
  for (const city of cities) {
    if (typeof city !== 'string') throw invalidInput('every city must be a string');
    const trimmed = city.trim();
    if (trimmed === '') throw invalidInput('every city must be a non-empty string');
    if (trimmed.length > 100) throw invalidInput('every city must be at most 100 characters');
    const key = normalize(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(trimmed);
  }
  if (ordered.length < 1) throw invalidInput('cities must contain at least one city');
  if (!baseUrl) throw invalidInput('geocode baseUrl is required');
  const pins = [];
  const failures = [];
  for (const city of ordered) {
    const key = normalize(city);
    const hit = cache.get(key);
    if (hit) {
      pins.push({ city, displayName: hit.displayName, lat: hit.lat, lon: hit.lon });
      continue;
    }
    const out = await geocode({ query: city, baseUrl, fetchImpl });
    const lat = out?.result ? Number(out.result.lat) : NaN;
    const lon = out?.result ? Number(out.result.lon) : NaN;
    if (out?.ok && out.result && Number.isFinite(lat) && Number.isFinite(lon)) {
      const pin = { city, displayName: out.result.displayName, lat, lon };
      cache.set(key, { displayName: pin.displayName, lat, lon });
      pins.push(pin);
    } else {
      failures.push(city);
    }
  }
  return { pins, failures };
}
