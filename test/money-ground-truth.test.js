// Money ground truth — G11/G12/G9/G14 (QA fix pass, 2026-10-29).
// G11: named room resolves via Ticketmaster venue search and scopes the
//   event lookup; unresolved/no-venue falls back to first-event behavior
//   labeled honestly as "not the offer room".
// G12: blank variable cost is distinct from explicit 0; net renders
//   "before variable costs" when blank, never as if costs were zero.
// G9: the Web arm is "LLM + Wikidata facts" — no generic-web claim anywhere
//   in user-visible copy (behavior unchanged: LLM + Wikidata facts only).
// G14: OSM is display-only, Wikidata is Web-arm input only — labeled as
//   such wherever they render, never as verdict inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runVerdict } from '../backend/src/pipeline.js';
import { breakEven } from '../backend/src/breakeven.js';
import { searchEvents, extractFirstVenueResult } from '../backend/src/ticketmaster.js';
import { baseDeps, baseInput, tmEventsWithCapacity } from './fixtures.js';

const FALLBACK = `first matching Ticketmaster event's venue, not the offer room`;

function tmVenuesResolved() {
  return async ({ keyword }) => {
    assert.equal(keyword, 'The Named Room');
    return {
      ok: true,
      status: 200,
      body: { _embedded: { venues: [{ id: 'tm-venue-123', name: 'The Named Room', capacity: 4000 }] } },
    };
  };
}

function tmVenuesEmpty() {
  return async () => ({ ok: true, status: 200, body: { _embedded: { venues: [] } } });
}

// First-event body (Test Room, 9000 seats, $100–140) vs venue-scoped body
// (The Named Room, 4000 seats, $90–110). Records every call's args.
function tmEventsCapturing(seen) {
  return async (args) => {
    seen.push(args);
    if (args.venueId === 'tm-venue-123') {
      return {
        ok: true,
        status: 200,
        body: {
          _embedded: {
            events: [{
              _embedded: { venues: [{ name: 'The Named Room', capacity: 4000 }] },
              priceRanges: [{ min: 90, max: 110, currency: 'USD' }],
            }],
          },
        },
      };
    }
    return {
      ok: true,
      status: 200,
      body: {
        _embedded: {
          events: [{
            _embedded: { venues: [{ name: 'Test Room', capacity: 9000 }] },
            priceRanges: [{ min: 100, max: 140, currency: 'USD' }],
          }],
        },
      },
    };
  };
}

test('G11: venue entered + resolved → venue capacity used, events scoped by venueId', async () => {
  const seen = [];
  const v = await runVerdict(
    baseInput({ venue: 'The Named Room' }),
    baseDeps({ tmVenues: tmVenuesResolved(), tmEvents: tmEventsCapturing(seen) }),
  );
  assert.equal(v.status, 'verdict');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].venueId, 'tm-venue-123');
  assert.equal(v.capacity.state, 'known');
  assert.equal(v.capacity.value, 4000);
  assert.equal(v.capacity.source, 'Ticketmaster-reported');
  assert.equal(v.ticketmaster.venueResolved, true);
  assert.equal(v.ticketmaster.venueName, 'The Named Room');
  assert.match(v.ticketmaster.grounding, /named room/);
  assert.ok(!v.ticketmaster.grounding.includes(FALLBACK), 'resolved grounding must not carry the fallback label');
});

test('G11: venue entered + resolved → its events price grounds the verdict, not first-event price', async () => {
  const { ticketPrice, ...noPrice } = baseInput({ venue: 'The Named Room' });
  const seen = [];
  const v = await runVerdict(
    noPrice,
    baseDeps({ tmVenues: tmVenuesResolved(), tmEvents: tmEventsCapturing(seen) }),
  );
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.price.value, 100); // average of scoped 90–110, not first-event 120
  assert.match(v.breakEven.price.source, /named room/);
  assert.ok(!v.breakEven.price.source.includes(FALLBACK));
});

test('G11: venue entered + unresolved → honest label + first-event fallback behavior', async () => {
  const seen = [];
  const v = await runVerdict(
    baseInput({ venue: 'No Such Room' }),
    baseDeps({ tmVenues: tmVenuesEmpty(), tmEvents: tmEventsCapturing(seen) }),
  );
  assert.equal(v.status, 'verdict');
  assert.equal(seen[0].venueId, undefined, 'unresolved room must not scope the event lookup');
  assert.equal(v.capacity.state, 'known');
  assert.equal(v.capacity.value, 9000, 'fallback still uses the first event venue capacity');
  assert.ok(v.capacity.source.includes(FALLBACK), `capacity source must carry the fallback label, got: ${v.capacity.source}`);
  assert.equal(v.ticketmaster.venueResolved, false);
  assert.match(v.ticketmaster.grounding, /did not resolve/);
  assert.ok(v.ticketmaster.grounding.includes(FALLBACK));
});

test('G11: no venue → honest label, not silent first-event grounding', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ tmEvents: tmEventsWithCapacity(5000) }));
  assert.equal(v.capacity.state, 'known');
  assert.equal(v.capacity.value, 5000);
  assert.ok(v.capacity.source.includes(FALLBACK));
  assert.equal(v.ticketmaster.venueResolved, false);
  assert.equal(v.ticketmaster.venueQuery, null);
  assert.ok(v.ticketmaster.grounding.includes(FALLBACK));
});

test('G11: no venue + Ticketmaster price → price source carries the fallback label', async () => {
  const { ticketPrice, ...noPrice } = baseInput();
  const v = await runVerdict(noPrice, baseDeps({ tmEvents: tmEventsWithCapacity(5000) }));
  assert.equal(v.status, 'verdict');
  // tmEventsWithCapacity price range is 100–140, average 120.
  assert.equal(v.breakEven.price.value, 120);
  assert.ok(v.breakEven.price.source.includes(FALLBACK));
});

test('G11: ticketmaster helpers — venue-search extraction + venueId scoping', async () => {
  assert.equal(extractFirstVenueResult({ _embedded: { venues: [{ name: 'A', capacity: 10 }] } }).name, 'A');
  assert.equal(extractFirstVenueResult({ _embedded: { venues: [] } }), null);
  assert.equal(extractFirstVenueResult({}), null);
  let capturedUrl = null;
  const out = await searchEvents({
    keyword: 'Billie Eilish',
    city: 'New York',
    venueId: 'tm-venue-123',
    key: 'test-key',
    baseUrl: 'https://example.test/discovery/v2',
    fetchImpl: async (url) => {
      capturedUrl = url;
      return { status: 200, json: async () => ({ _embedded: { events: [] } }) };
    },
  });
  assert.equal(out.ok, true);
  assert.ok(capturedUrl.includes('venueId=tm-venue-123'), `events URL must scope by venueId, got: ${capturedUrl}`);
});

test('G12: cost entered → net and break-even reflect it', async () => {
  const v = await runVerdict(baseInput({ variableCost: 20 }), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.net, 100);
  assert.equal(v.breakEven.tickets, 2500);
  assert.deepEqual(v.breakEven.variableCost, { value: 20, provided: true });
});

test('G12: blank cost → net is before variable costs, never zero-cost', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.net, 120);
  assert.equal(v.breakEven.tickets, 2084);
  assert.deepEqual(v.breakEven.variableCost, { value: null, provided: false });
});

test('G12: explicit zero cost → net = price with cost shown as 0, distinct from blank', async () => {
  const v = await runVerdict(baseInput({ variableCost: 0 }), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.net, 120);
  assert.deepEqual(v.breakEven.variableCost, { value: 0, provided: true });
  const blank = await runVerdict(baseInput(), baseDeps());
  assert.notDeepEqual(v.breakEven.variableCost, blank.breakEven.variableCost);
});

test('G12: breakeven echoes the cost actually subtracted', () => {
  assert.equal(breakEven({ guarantee: 9000, ticketPrice: 50, variableCost: 5 }).variableCost, 5);
  assert.equal(breakEven({ guarantee: 0, ticketPrice: 50, variableCost: 5 }).variableCost, 5);
});

test('G12/G11: form fields exist in order and are queried by app.js', async () => {
  const html = await readFile(new URL('../frontend/app.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
  assert.ok(html.includes('id="venue"'), 'venue field must exist in app.html');
  assert.ok(html.includes('id="variableCost"'), 'variableCost field must exist in app.html');
  assert.ok(html.indexOf('id="city"') < html.indexOf('id="venue"'), 'venue field follows city');
  assert.ok(html.indexOf('id="ticketPrice"') < html.indexOf('id="variableCost"'), 'variableCost field follows ticket price');
  assert.ok(app.includes(`$('venue')`), 'app.js must query the venue field');
  assert.ok(app.includes(`$('variableCost')`), 'app.js must query the variableCost field');
  assert.ok(app.includes('body.venue'), 'submitVerdict must send venue');
  assert.ok(app.includes('body.variableCost'), 'submitVerdict must send variableCost');
  // Blank-cost rendering: the net line and the worked example must both
  // carry the "before variable costs" wording, and the worked example's
  // blank branch must not render a "− 0".
  assert.ok(app.includes('(before variable costs)'), 'net must render "before variable costs" when blank');
  assert.ok(app.includes('before variable costs: no variable cost was entered'), 'worked example must explain the blank cost');
});

test('G9: Web arm is labeled "LLM + Wikidata facts" and no generic-web claim remains', async () => {
  const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
  const arms = await readFile(new URL('../backend/src/arms.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../frontend/app.html', import.meta.url), 'utf8');
  const pipeline = await readFile(new URL('../backend/src/pipeline.js', import.meta.url), 'utf8');
  assert.ok(app.includes('Web (LLM + Wikidata facts)'), 'race lane must use the honest label');
  assert.ok(arms.includes('LLM + Wikidata facts'), 'arms.js must use the honest label');
  assert.ok(arms.includes('Wikidata facts below'), 'Web arm prompt must name Wikidata facts');
  for (const [name, src] of [['app.js', app], ['arms.js', arms], ['app.html', html], ['pipeline.js', pipeline]]) {
    assert.ok(!src.includes('generic web'), `${name} must not contain a generic-web claim`);
  }
});

test('G14: OSM is display-only and Wikidata is Web-arm input only, at pipeline and UI level', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.match(v.osm.scope, /display-only/);
  assert.match(v.osm.scope, /never fed into Qloo filters/);
  assert.match(v.wikidata.scope, /input to the Web arm only/);
  assert.match(v.wikidata.scope, /never a direct verdict input/);
  const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('display-only — shown for confirmation, never fed into Qloo filters'), 'OSM leg row must carry its scope label');
  assert.ok(app.includes('input to the Web arm only, never a direct verdict input'), 'Wikidata leg row must carry its scope label');
});
