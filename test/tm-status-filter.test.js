// Track57 patch 11 (B6 fix): extractPrice skips canceled/cancelled/postponed
// events and keeps rescheduled ones. A stale price range from a dead event
// must never ground break-even.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPrice, eventStatusCode } from '../backend/src/ticketmaster.js';

const priced = (code, min, max) => ({
  dates: { status: { code } },
  priceRanges: [{ min, max, currency: 'USD' }],
});
const body = (...events) => ({ _embedded: { events } });

test('t57-11: canceled event price is skipped for the next priced event', () => {
  const p = extractPrice(body(priced('canceled', 100, 200), priced('onsale', 40, 60)));
  assert.equal(p.price, 50);
  assert.equal(eventStatusCode(priced('canceled', 1, 2)), 'canceled');
});

test('t57-11: cancelled (double-l) spelling is skipped too', () => {
  const p = extractPrice(body(priced('cancelled', 100, 200), priced('onsale', 40, 60)));
  assert.equal(p.price, 50);
  assert.equal(eventStatusCode(priced('cancelled', 1, 2)), 'cancelled');
});

test('t57-11: postponed event price is skipped for the next priced event', () => {
  const p = extractPrice(body(priced('postponed', 100, 200), priced('onsale', 40, 60)));
  assert.equal(p.price, 50);
});

test('t57-11: rescheduled event price is KEPT (price may still be live)', () => {
  const p = extractPrice(body(priced('rescheduled', 40, 60)));
  assert.equal(p.price, 50);
  assert.match(p.source, /average of Ticketmaster price range/);
});
