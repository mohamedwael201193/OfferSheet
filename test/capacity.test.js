// T11 — missing-capacity state (pure + pipeline with injected test deps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCapacity, extractPrice } from '../backend/src/ticketmaster.js';
import { runVerdict } from '../backend/src/pipeline.js';
import {
  baseDeps, baseInput, tmEventsWithCapacity, tmEventsNoPrice,
} from './fixtures.js';

const UNKNOWN_WORDING = 'Venue capacity unknown — Ticketmaster returned no capacity for this room. Break-even is shown as tickets needed, not as a sellout percentage. Verify room size before signing.';

function collectKeys(obj, out = new Set()) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      out.add(k.toLowerCase());
      collectKeys(v, out);
    }
  }
  return out;
}

test('T11: capacity extraction — missing fields yield null, never a guess', () => {
  assert.equal(extractCapacity(null), null);
  assert.equal(extractCapacity({}), null);
  assert.equal(extractCapacity({ name: 'Test Room' }), null);
  assert.equal(extractCapacity({ generalInfo: {} }), null);
  assert.equal(extractCapacity({ capacity: 5000 }), 5000);
  assert.equal(extractCapacity({ seatingCapacity: 3000 }), 3000);
  assert.equal(extractCapacity({ capacity: 'big' }), null);
  assert.equal(extractCapacity({ capacity: -5 }), null);
});

test('T11: price extraction — average of min/max, labeled; absent means null', () => {
  const body = { _embedded: { events: [{ priceRanges: [{ min: 100, max: 140, currency: 'USD' }] }] } };
  const p = extractPrice(body);
  assert.equal(p.price, 120);
  assert.match(p.source, /average/i);
  assert.equal(extractPrice({ _embedded: { events: [{}] } }), null);
  assert.equal(extractPrice({}), null);
});

test('T11: pipeline with no Ticketmaster capacity renders unknown state, no sellout fields', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.capacity.state, 'unknown');
  assert.equal(v.capacity.value, null);
  assert.equal(v.capacity.message, UNKNOWN_WORDING);
  assert.equal(v.breakEven.tickets, 2084);
  const keys = collectKeys(v);
  assert.ok(!keys.has('selloutpercentage'), 'no selloutPercentage key may render');
  assert.ok(!keys.has('willsellout'), 'no willSellOut key may render');
  assert.ok(!keys.has('roomfill'), 'no roomFill key may render');
});

test('T11: user-supplied capacity renders labeled, never as Ticketmaster-verified', async () => {
  const v = await runVerdict(baseInput({ capacity: 5000 }), baseDeps());
  assert.equal(v.capacity.state, 'known');
  assert.equal(v.capacity.value, 5000);
  assert.equal(v.capacity.source, 'user-supplied, not Ticketmaster-verified');
});

test('T11: Ticketmaster-reported capacity renders with its source', async () => {
  // G11 (intentional change, 2026-10-29): with NO venue entered, the
  // first-event capacity is no longer labeled with the bare
  // 'Ticketmaster-reported' — it now carries the honest "not the offer
  // room" suffix. The bare label survives only for a venue-search-resolved
  // room (see money-ground-truth.test.js, G11 resolved case).
  const v = await runVerdict(baseInput(), baseDeps({ tmEvents: tmEventsWithCapacity(5000) }));
  assert.equal(v.capacity.state, 'known');
  assert.equal(v.capacity.value, 5000);
  assert.equal(v.capacity.source, `Ticketmaster-reported — first matching Ticketmaster event's venue, not the offer room`);
});

test('T11: no price anywhere yields price_unknown, never an invented number', async () => {
  const { ticketPrice, ...noPrice } = baseInput();
  const v = await runVerdict(noPrice, baseDeps({ tmEvents: tmEventsNoPrice() }));
  assert.equal(v.status, 'price_unknown');
  assert.ok(!('breakEven' in v), 'no break-even number may render without a price');
});
