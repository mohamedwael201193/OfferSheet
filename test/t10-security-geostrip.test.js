// T10 (security + fail-closed): the display-only geocode batch path is
// bounded on both axes an unbounded caller can grow — cache entries and
// concurrent batches. The Nominatim 1-request-per-second serialization in
// osm.js bounds throughput but not queue depth or cache size; these tests
// pin the two new bounds in backend/src/geostrip.js with fixture
// transports (no live Nominatim call).
import test from 'node:test';
import assert from 'node:assert/strict';
import { geocodeCities, clearGeocodeCache } from '../backend/src/geostrip.js';

const BASE = 'https://example.invalid';

function okFetch(body) {
  return async () => ({ ok: true, status: 200, json: async () => body });
}

test('T10 geostrip: cache holds at most maxCacheEntries — the oldest city is evicted first', async () => {
  clearGeocodeCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => [{ display_name: `City ${calls}, Test`, lat: '10', lon: '20' }] };
  };
  const first = await geocodeCities(['Alpha', 'Beta', 'Gamma', 'Delta'], { fetchImpl, baseUrl: BASE, maxCacheEntries: 3 });
  assert.equal(first.pins.length, 4);
  assert.equal(calls, 4, 'one lookup per distinct city on the first batch');
  // Beta/Gamma/Delta are still cached (only Alpha, the oldest, evicted).
  const cached = await geocodeCities(['Beta'], { fetchImpl, baseUrl: BASE, maxCacheEntries: 3 });
  assert.equal(cached.pins.length, 1);
  assert.equal(calls, 4, 'a still-cached city must not trigger a new lookup');
  // Alpha was evicted, so it re-fetches exactly once.
  const refetched = await geocodeCities(['Alpha'], { fetchImpl, baseUrl: BASE, maxCacheEntries: 3 });
  assert.equal(refetched.pins.length, 1);
  assert.equal(calls, 5, 'an evicted city re-fetches once');
});

test('T10 geostrip: an excess concurrent batch is refused 503 while one batch is in flight, and the slot frees afterwards', async () => {
  clearGeocodeCache();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const blockingFetch = () => gate.then(() => ({ ok: true, status: 200, json: async () => [{ display_name: 'Alpha, Test', lat: '10', lon: '20' }] }));
  const inFlight = geocodeCities(['Alpha'], { fetchImpl: blockingFetch, baseUrl: BASE, maxInFlight: 1 });
  await assert.rejects(
    geocodeCities(['Beta'], { fetchImpl: okFetch([]), baseUrl: BASE, maxInFlight: 1 }),
    (e) => e.code === 'GEOCODE_BUSY' && e.status === 503,
    'excess batch must fail closed with 503, never queue',
  );
  release();
  const done = await inFlight;
  assert.equal(done.pins.length, 1);
  assert.equal(done.pins[0].city, 'Alpha');
  // The slot freed: a later batch succeeds (also proves the finally
  // decrement runs on the completed path).
  const after = await geocodeCities(['Gamma'], { fetchImpl: okFetch([{ display_name: 'Gamma, Test', lat: '30', lon: '40' }]), baseUrl: BASE, maxInFlight: 1 });
  assert.equal(after.pins.length, 1);
});

test('T10 geostrip: malformed input still gets 400, never the 503 busy signal', async () => {
  await assert.rejects(
    geocodeCities(['x'.repeat(101)], { fetchImpl: okFetch([]), baseUrl: BASE, maxInFlight: 0 }),
    (e) => e.code === 'INVALID_INPUT' && e.status === 400,
    'validation precedes the concurrency bound',
  );
});
