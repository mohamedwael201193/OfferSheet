// Phase 4: routing map strip (geostrip) + streamed-legs wiring lock-in +
// catalogue-gate copy + license visibility. No live keys anywhere: the
// geocode unit tests stub the Nominatim transport; the static tests read
// the shipped files. Coordinates are never guessed in production code —
// a city that does not resolve is omitted and labelled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { geocodeCities, clearGeocodeCache } from '../backend/src/geostrip.js';

const serverJs = readFileSync(fileURLToPath(new URL('../backend/server.js', import.meta.url)), 'utf8');
const workspaceJs = readFileSync(fileURLToPath(new URL('../frontend/workspace.js', import.meta.url)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('../frontend/app.js', import.meta.url)), 'utf8');
const stylesCss = readFileSync(fileURLToPath(new URL('../frontend/styles.css', import.meta.url)), 'utf8');
const toolsHtml = readFileSync(fileURLToPath(new URL('../frontend/tools.html', import.meta.url)), 'utf8');
const indexHtml = readFileSync(fileURLToPath(new URL('../frontend/index.html', import.meta.url)), 'utf8');
const docsHtml = readFileSync(fileURLToPath(new URL('../frontend/docs.html', import.meta.url)), 'utf8');

const BASE = 'https://nominatim.openstreetmap.org';

function stubFetch(resultsByQuery) {
  const calls = [];
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams.get('q');
    calls.push(q);
    const entry = resultsByQuery[q];
    if (entry === 'http-error') return { ok: false, status: 500, json: async () => null };
    if (!entry) return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 200, json: async () => [entry] };
  };
  return { fetchImpl, calls };
}

test('geostrip: validation rejects bad input before any lookup', async () => {
  clearGeocodeCache();
  const fetchImpl = async () => ({ ok: true, json: async () => [] });
  for (const bad of [[], Array(12).fill('X'), 'New York', [123], [''], ['x'.repeat(101)], [null]]) {
    await assert.rejects(() => geocodeCities(bad, { fetchImpl, baseUrl: BASE }), (e) => e.code === 'INVALID_INPUT');
  }
  await assert.rejects(() => geocodeCities(['Paris'], { fetchImpl }), (e) => e.code === 'INVALID_INPUT');
});

test('geostrip: success batch returns numeric pins, failures omitted and listed', async () => {
  clearGeocodeCache();
  const { fetchImpl, calls } = stubFetch({
    'New York': { display_name: 'New York, USA', lat: '40.7128', lon: '-74.0060' },
    'Los Angeles': { display_name: 'Los Angeles, USA', lat: '34.0522', lon: '-118.2437' },
    Nowhereville: 'http-error',
  });
  const out = await geocodeCities(['New York', 'Los Angeles', 'Nowhereville'], { fetchImpl, baseUrl: BASE });
  assert.equal(out.pins.length, 2);
  assert.equal(out.failures.length, 1);
  assert.equal(out.failures[0], 'Nowhereville');
  const ny = out.pins.find((p) => p.city === 'New York');
  assert.equal(typeof ny.lat, 'number');
  assert.equal(typeof ny.lon, 'number');
  assert.ok(Math.abs(ny.lat - 40.7128) < 1e-9);
  assert.ok(Math.abs(ny.lon - (-74.0060)) < 1e-9);
  assert.equal(calls.length, 3);
});

test('geostrip: dedupe within a batch and cache across calls (no refetch)', async () => {
  clearGeocodeCache();
  const { fetchImpl, calls } = stubFetch({
    Paris: { display_name: 'Paris, France', lat: '48.8566', lon: '2.3522' },
  });
  const first = await geocodeCities(['Paris', 'paris ', 'PARIS'], { fetchImpl, baseUrl: BASE });
  assert.equal(first.pins.length, 1);
  assert.equal(calls.length, 1);
  const second = await geocodeCities(['Paris'], { fetchImpl, baseUrl: BASE });
  assert.equal(second.pins.length, 1);
  assert.equal(calls.length, 1, 'cached city must not refetch');
});

test('geostrip: non-finite coordinates are a failure, never a placed pin', async () => {
  clearGeocodeCache();
  const { fetchImpl } = stubFetch({
    Atlantis: { display_name: 'Atlantis', lat: 'abc', lon: 'def' },
  });
  const out = await geocodeCities(['Atlantis'], { fetchImpl, baseUrl: BASE });
  assert.equal(out.pins.length, 0);
  assert.deepEqual(out.failures, ['Atlantis']);
});

test('geostrip: server route wired, frontend strip wired to cities only', () => {
  assert.ok(serverJs.includes("'/api/workspace/geocode'"), 'server must route POST /api/workspace/geocode');
  assert.ok(serverJs.includes("from './src/geostrip.js'"), 'server must import the geostrip module');
  assert.ok(workspaceJs.includes("id=\"wsMapStrip\""), 'routing panel must render the strip container');
  assert.ok(workspaceJs.includes("'/api/workspace/geocode'"), 'workspace must call the geocode endpoint');
  assert.equal(workspaceJs.split("'/api/workspace/geocode'").length - 1, 1, 'exactly one geocode call site');
  assert.ok(workspaceJs.includes('push(ws.baseOffer.city)'), 'strip cities start from the base city');
  assert.ok(workspaceJs.includes('(res.candidates || []).forEach'), 'strip cities come from routing candidates');
  assert.ok(workspaceJs.includes('body: JSON.stringify({ cities: cities })'), 'geocode request sends city strings only');
  assert.ok(!workspaceJs.includes('Map strip unavailable — no geography lookup is wired'), 'old unavailable note must be gone');
  assert.ok(workspaceJs.includes('function mapStripHtml'), 'strip SVG builder must exist');
  assert.ok(workspaceJs.includes('function loadMapStrip'), 'strip loader must exist');
  assert.ok(workspaceJs.includes('loadMapStrip();'), 'renderPanels must trigger the strip load');
});

test('streamed legs: server emits leg events and client renders them live', () => {
  assert.ok(serverJs.includes("emit('leg'"), 'stream handler must emit leg events');
  assert.ok(serverJs.includes("'/api/verdict/stream'"), 'stream endpoint must be routed');
  assert.ok(appJs.includes('function appendLegProgress'), 'client must append leg progress lines');
  assert.ok(appJs.includes("ev === 'leg'"), 'client must handle leg events');
  assert.ok(appJs.includes('submitVerdictStreamed(body)'), 'non-race runs must try the stream first');
  assert.ok(stylesCss.includes('.leg-progress'), 'leg progress list must be styled');
});

test('catalogue gate copy: own server stated with the 23+10 split, stale sentence gone', () => {
  assert.ok(toolsHtml.includes('33 tools: 23 OfferSheet tools + 10 guarded Qloo tools'), 'catalogue must state the split');
  assert.ok(toolsHtml.includes('node backend/mcp-server.js'), 'catalogue must give the start command');
  assert.ok(toolsHtml.includes('"offersheet"'), 'catalogue must give the client config block');
  assert.ok(toolsHtml.includes('Proven 29 Oct 2026'), 'catalogue must date the fresh-clone + replay proofs');
  assert.ok(!toolsHtml.includes('has no MCP server of its own'), 'stale no-server sentence must be gone');
});

test('submission checklist: license visible on served pages', () => {
  for (const [name, html] of [['index', indexHtml], ['docs', docsHtml]]) {
    assert.ok(html.includes('MIT License'), `${name} footer must state the MIT license`);
    assert.ok(html.includes('github.com/mohamedwael201193/OfferSheet'), `${name} footer must link the public repo`);
  }
});
