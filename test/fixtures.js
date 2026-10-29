// Test-only fixtures — LABELLED, never imported by production code.
// Production code (backend/src) must never import this file (enforced by T16).
// All IDs here are obviously fake ('test-entity-*'); they assert pipeline logic,
// never real Qloo data.
import { Guards } from '../backend/src/guards.js';
import { ReceiptStore } from '../backend/src/receipts.js';

export function baseConfig(overrides = {}) {
  return {
    qlooKeyConfigured: true,
    tmKeyConfigured: true,
    qlooBaseUrl: 'https://hackathon.api.qloo.com',
    ticketmasterBaseUrl: 'https://app.ticketmaster.com/discovery/v2',
    osmBaseUrl: 'https://nominatim.openstreetmap.org',
    wikidataBaseUrl: 'https://www.wikidata.org/w/api.php',
    ...overrides,
  };
}

export function mcpFixture(overrides = {}) {
  const table = {
    qloo_capabilities: { status: 'ok', operations: ['recommend', 'rank', 'describe', 'where_popular', 'compare_audiences', 'entity_tags', 'audience_demographics', 'trends', 'find_tags'] },
    qloo_find_tags: { status: 'ok', results: [{ name: 'Billie Eilish', id: 'test-tag-billie' }] },
    qloo_describe: { status: 'ok', results: [{ id: 'test-entity-billie', name: 'Billie Eilish' }] },
    qloo_recommend: { status: 'ok', results: [{ id: 'test-entity-opener-1', name: 'Test Opener One' }, { id: 'test-entity-opener-2', name: 'Test Opener Two' }] },
    qloo_rank: { status: 'ok', results: [{ id: 'test-entity-opener-1', name: 'Test Opener One' }, { id: 'test-entity-opener-2', name: 'Test Opener Two' }] },
    qloo_where_popular: { status: 'ok', results: [{ name: 'New York' }, { name: 'Los Angeles' }] },
    qloo_audience_demographics: { status: 'ok', results: [{ band: '18-24', share: 'test' }] },
    qloo_compare_audiences: { status: 'ok', results: [{ overlap: 'test' }] },
    qloo_entity_tags: { status: 'ok', results: [{ tag: 'test-tag' }] },
    qloo_trends: { status: 'ok', results: [{ date: '2026-10-01', value: 1 }] },
    ...overrides,
  };
  return async (tool, args) => {
    if (tool in table) {
      const v = table[tool];
      if (v instanceof Error) throw v;
      return v;
    }
    throw new Error(`test fixture: unknown tool ${tool}`);
  };
}

export function restFixture(overrides = {}) {
  const table = {
    '/search': { ok: true, status: 200, requestHash: 'test-hash-search', requestId: 'test-request-1', resultCount: 2, entities: [{ id: 'test-entity-billie', name: 'Billie Eilish' }] },
    '/v2/insights': { ok: true, status: 200, requestHash: 'test-hash-insights', requestId: 'test-request-2', resultCount: 3, entities: [] },
    ...overrides,
  };
  return async ({ path }) => table[path] || { ok: true, status: 200, requestHash: 'test-hash', requestId: null, resultCount: 0, entities: [] };
}

// Ticketmaster fixture: venue WITHOUT capacity (mirrors the real Madison Square
// Garden response, which carries no capacity field) + a price range.
export function tmEventsNoCapacity() {
  return async () => ({
    ok: true,
    status: 200,
    body: {
      _embedded: {
        events: [{
          _embedded: { venues: [{ name: 'Test Room' }] },
          priceRanges: [{ min: 100, max: 140, currency: 'USD' }],
        }],
      },
    },
  });
}

export function tmEventsWithCapacity(capacity) {
  return async () => ({
    ok: true,
    status: 200,
    body: {
      _embedded: {
        events: [{
          _embedded: { venues: [{ name: 'Test Room', capacity }] },
          priceRanges: [{ min: 100, max: 140, currency: 'USD' }],
        }],
      },
    },
  });
}

export function tmEventsNoPrice() {
  return async () => ({
    ok: true,
    status: 200,
    body: { _embedded: { events: [{ _embedded: { venues: [{ name: 'Test Room' }] } }] } },
  });
}

export function geocodeFixture() {
  return async () => ({ ok: true, status: 200, result: { displayName: 'New York, USA', lat: '40.7', lon: '-74.0' } });
}

export function wikidataFixture() {
  return async () => ({ ok: true, status: 200, results: [{ id: 'Q-test', label: 'Billie Eilish', description: 'American singer' }] });
}

// Arms fixture: Gut MISSES (picks Opener Two), Web MATCHES Graph (Opener One).
export function armsFixture() {
  return {
    gutArm: async () => ({ arm: 'gut', status: 'ok', pick: 'Test Opener Two' }),
    webArm: async () => ({ arm: 'web', status: 'ok', pick: 'Test Opener One' }),
  };
}

export function baseDeps(overrides = {}) {
  const arms = armsFixture();
  return {
    config: baseConfig(),
    guards: new Guards(),
    receipts: new ReceiptStore(),
    checkCall: () => {},
    mcpCall: mcpFixture(),
    restCall: restFixture(),
    tmEvents: tmEventsNoCapacity(),
    geocodeFn: geocodeFixture(),
    wikidataFn: wikidataFixture(),
    gutArm: arms.gutArm,
    webArm: arms.webArm,
    ...overrides,
  };
}

export function baseInput(overrides = {}) {
  return {
    artist: 'Billie Eilish',
    city: 'New York',
    guarantee: 250000,
    ticketPrice: 120,
    ...overrides,
  };
}
