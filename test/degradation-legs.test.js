// D4 — Degradation rules for the three external legs (MAX §4): Ticketmaster
// down -> leg unavailable, Qloo evidence still renders, no capacity invented;
// OSM failure -> city as typed, omission disclosed; Wikidata failure -> leg
// omitted, verdict not blocked. Plus stub-level checks of the real leg clients
// (geocode 1 req/sec serialization, Wikidata/Ticketmaster shapes).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput } from './fixtures.js';
import { geocode } from '../backend/src/osm.js';
import { searchEntities } from '../backend/src/wikidata.js';
import { searchEvents } from '../backend/src/ticketmaster.js';

const tmDown = async () => { throw new Error('Ticketmaster connection refused'); };
const tm500 = async () => ({ ok: false, status: 500, body: null });

test('D4: Ticketmaster throwing still renders the verdict with unknown capacity', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ tmEvents: tmDown }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.tickets, 2084);
  assert.equal(v.audience.areas.length, 2);
  assert.equal(v.ticketmaster.status, 'error');
  assert.equal(v.capacity.state, 'unknown');
  assert.equal(v.capacity.value, null);
});

test('D4: Ticketmaster 500 still renders the verdict, no capacity invented', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ tmEvents: tm500 }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.ticketmaster.status, 'error');
  assert.equal(v.capacity.state, 'unknown');
  assert.equal(v.capacity.value, null);
});

test('D4: Ticketmaster down plus no price anywhere yields price_unknown, never invented', async () => {
  const { ticketPrice, ...noPrice } = baseInput();
  const v = await runVerdict(noPrice, baseDeps({ tmEvents: tmDown }));
  assert.equal(v.status, 'price_unknown');
  assert.ok(!('breakEven' in v), 'no break-even number may render without a price');
});

test('D4: Ticketmaster down does not block a user-supplied capacity', async () => {
  const v = await runVerdict(baseInput({ capacity: 5000 }), baseDeps({ tmEvents: tmDown }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.ticketmaster.status, 'error');
  assert.equal(v.capacity.state, 'known');
  assert.equal(v.capacity.value, 5000);
  assert.equal(v.capacity.source, 'user-supplied, not Ticketmaster-verified');
});

test('D4: OSM throwing still renders the verdict, city as typed, no coordinates', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    geocodeFn: async () => { throw new Error('Nominatim unreachable'); },
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.city, 'New York');
  assert.equal(v.osm.status, 'error');
  assert.ok(!('lat' in v.osm) && !('lon' in v.osm), 'no guessed coordinate may appear');
});

test('D4: OSM unavailable discloses the omission (city used as typed)', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    geocodeFn: async () => ({ ok: false, status: 500, result: null }),
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.osm.status, 'unavailable');
  assert.match(v.osm.note, /as typed/);
  assert.equal(v.city, 'New York');
});

test('D4: OSM empty result discloses the omission, never a guessed place', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    geocodeFn: async () => ({ ok: true, status: 200, result: null }),
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.osm.status, 'unavailable');
  assert.match(v.osm.note, /as typed/);
});

test('D4: Wikidata throwing omits the leg, verdict and miss trial still render', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    wikidataFn: async () => { throw new Error('Wikidata unreachable'); },
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.wikidata.status, 'error');
  assert.ok(v.missTrial && v.missTrial.misses.length === 1, 'miss trial survives a failed cross-check leg');
});

test('D4: Wikidata 500 omits the leg, verdict not blocked', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    wikidataFn: async () => ({ ok: false, status: 500, results: [] }),
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.wikidata.status, 'error');
});

function stubServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

test('D4: real geocode client against a local stub returns display name + coords', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ display_name: 'New York, USA', lat: '40.7', lon: '-74.0' }]));
  });
  try {
    const out = await geocode({ query: 'New York', baseUrl: `http://127.0.0.1:${s.port}` });
    assert.equal(out.ok, true);
    assert.equal(out.result.displayName, 'New York, USA');
    assert.equal(out.result.lat, '40.7');
    assert.equal(out.result.lon, '-74.0');
  } finally { s.close(); }
});

test('D4: real geocode client serializes calls >=1100ms apart (1 req/sec policy)', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ display_name: 'X', lat: '0', lon: '0' }]));
  });
  try {
    await geocode({ query: 'First', baseUrl: `http://127.0.0.1:${s.port}` });
    const t1 = Date.now();
    await geocode({ query: 'Second', baseUrl: `http://127.0.0.1:${s.port}` });
    const gap = Date.now() - t1;
    assert.ok(gap >= 900, `second geocode must wait ~1100ms, waited ${gap}ms`);
  } finally { s.close(); }
});

test('D4: real geocode client maps a stub 500 to ok:false, never a guess', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    const out = await geocode({ query: 'Nowhere', baseUrl: `http://127.0.0.1:${s.port}` });
    assert.equal(out.ok, false);
    assert.equal(out.status, 500);
    assert.equal(out.result, null);
  } finally { s.close(); }
});

test('D4: real Wikidata client against a local stub maps search results', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ search: [{ id: 'Q-test-1', label: 'Billie Eilish', description: 'American singer' }] }));
  });
  try {
    const out = await searchEntities({ query: 'Billie Eilish', baseUrl: `http://127.0.0.1:${s.port}/w/api.php` });
    assert.equal(out.ok, true);
    assert.deepEqual(out.results, [{ id: 'Q-test-1', label: 'Billie Eilish', description: 'American singer' }]);
  } finally { s.close(); }
});

test('D4: real Ticketmaster client against a local stub reports ok + status', { timeout: 30000 }, async () => {
  let capturedUrl = '';
  const s = await stubServer((req, res) => {
    capturedUrl = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ _embedded: { events: [] } }));
  });
  try {
    const out = await searchEvents({ keyword: 'Jazz', city: 'New York', key: 'test-only-not-a-real-key', baseUrl: `http://127.0.0.1:${s.port}` });
    assert.equal(out.ok, true);
    assert.equal(out.status, 200);
    // Ticketmaster's documented auth is a query-string apikey, server-side only.
    assert.ok(capturedUrl.includes('apikey='), 'Ticketmaster auth travels as apikey param');
  } finally { s.close(); }
});
