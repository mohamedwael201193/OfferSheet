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
import { invalidInput, OfferError } from './errors.js';

const cache = new Map(); // normalized city -> { displayName, lat, lon }
// Bounds (fail-closed, not quotas): the cache must never grow unboundedly
// from distinct-city input, and concurrent batches must never queue
// unboundedly behind the 1-request-per-second Nominatim serialization in
// osm.js — an excess batch is refused with 503 while earlier batches
// drain, and the routing table stays authoritative meanwhile.
const MAX_CACHE_ENTRIES = 500;
const MAX_IN_FLIGHT_BATCHES = 2;
let inFlightBatches = 0;

export function clearGeocodeCache() {
  cache.clear();
}

function normalize(city) {
  return city.trim().toLowerCase();
}

export async function geocodeCities(cities, { fetchImpl = fetch, baseUrl, maxCacheEntries = MAX_CACHE_ENTRIES, maxInFlight = MAX_IN_FLIGHT_BATCHES } = {}) {
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
  // Concurrency bound AFTER validation (malformed input still gets its
  // 400, never a 503): a batch that arrives while the maximum is in
  // flight is refused, never queued behind the serialization delay.
  if (inFlightBatches >= maxInFlight) {
    throw new OfferError('GEOCODE_BUSY', 503, 'Geocode busy — too many geography batches in flight. The routing table is the full result; retry the map strip shortly.');
  }
  inFlightBatches += 1;
  try {
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
        // FIFO eviction of the oldest entry: the cache holds the most
        // recent entries only, never an unbounded distinct-city set.
        while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
        pins.push(pin);
      } else {
        failures.push(city);
      }
    }
    return { pins, failures };
  } finally {
    inFlightBatches -= 1;
  }
}
