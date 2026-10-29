// J3 adversarial fixes (program-30 fix agent F-ADVERSARIAL).
// B1 visitor-IP helper, B3 cost>=price 400, B5 depth wording, M2 toolbar
// disable, M1 elapsed timer + stream-retry note, M7 city-preferring venue
// choice, and the negative-price minor. No test here weakens a pinned
// requirement: every assertion adds a pin on top of the existing suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { visitorIpFor } from '../backend/src/guards.js';
import { extractPrice, extractVenueForCity, venueCityOf } from '../backend/src/ticketmaster.js';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput } from './fixtures.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// --- B1: visitorIpFor ---
test('J3 B1: X-Forwarded-For present -> first entry is the key (trimmed)', () => {
  const req = { headers: { 'x-forwarded-for': ' 203.0.113.7, 198.51.100.2, 192.0.2.1 ' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(visitorIpFor(req), '203.0.113.7');
});

test('J3 B1: X-Forwarded-For absent -> socket address is the key', () => {
  assert.equal(visitorIpFor({ headers: {}, socket: { remoteAddress: '10.0.0.1' } }), '10.0.0.1');
  assert.equal(visitorIpFor({ socket: { remoteAddress: '10.0.0.1' } }), '10.0.0.1');
});

test('J3 B1: empty / blank X-Forwarded-For falls back to the socket address; neither -> unknown', () => {
  assert.equal(visitorIpFor({ headers: { 'x-forwarded-for': '   ' }, socket: { remoteAddress: '10.0.0.1' } }), '10.0.0.1');
  assert.equal(visitorIpFor({ headers: { 'x-forwarded-for': ', 198.51.100.2' }, socket: { remoteAddress: '10.0.0.1' } }), '10.0.0.1');
  assert.equal(visitorIpFor({}), 'unknown');
});

test('J3 B1: server.js uses the helper at every visitor site, never raw socket address', () => {
  const src = read('backend/server.js');
  assert.ok(src.includes("import { Guards, visitorIpFor } from './src/guards.js'"));
  assert.equal((src.match(/visitorIpFor\(req\)/g) || []).length, 7);
  assert.ok(!src.includes('remoteAddress'), 'no raw remoteAddress left in server.js');
});

// --- B3: cost >= price is INVALID_INPUT 400, never a plain-Error 500 ---
async function rejectsCost(input, pattern) {
  await assert.rejects(
    () => runVerdict(input, baseDeps()),
    (e) => e.code === 'INVALID_INPUT' && e.status === 400 && pattern.test(e.message),
  );
}

test('J3 B3: user variable cost equal to ticket price -> 400, not 500', async () => {
  await rejectsCost(baseInput({ ticketPrice: 120, variableCost: 120 }), /variable cost must be below the ticket price/);
});

test('J3 B3: user variable cost above ticket price -> 400, not 500', async () => {
  await rejectsCost(baseInput({ ticketPrice: 120, variableCost: 121 }), /variable cost must be below the ticket price/);
});

test('J3 B3: Ticketmaster-supplied price at or below the variable cost -> 400', async () => {
  // Fixture TM price is the average of 100..140 = 120.
  await rejectsCost(baseInput({ ticketPrice: undefined, variableCost: 120 }), /variable cost must be below the ticket price/);
});

test('J3 B3: variable cost just below the price still yields a verdict', async () => {
  const v = await runVerdict(baseInput({ ticketPrice: 120, variableCost: 119 }), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.net, 1);
});

test('J3 B3: form carries the cross-field hint; label text unchanged', () => {
  const html = read('frontend/app.html');
  assert.ok(html.includes('<label for="variableCost">Variable cost per ticket (USD, optional)</label>'));
  assert.ok(html.includes('Must stay below the ticket price, or no break-even count exists.'));
});

// --- B2: LICENSE present in the tree root ---
test('J3 B2: LICENSE exists at the tree root and is an MIT license', () => {
  const lic = read('LICENSE');
  assert.ok(lic.length > 100);
  assert.match(lic, /MIT License/);
  assert.match(lic, /Permission is hereby granted, free of charge/);
});

// --- B5(a)(b): depth-panel line only ---
test('J3 B5: depth line is conditional + collective, never per-verdict', () => {
  const html = read('frontend/app.html');
  assert.ok(!html.includes('10 of 10 official Qloo tools, wired into the verdict — 8 of them receipted live.'));
  assert.ok(html.includes('each invoked when its precondition holds, receipted only when it returns data'));
  assert.ok(html.includes('8 receipted live across the 3 recorded trials (collective, not per verdict)'));
});

// --- M2: toolbar Run button disabled by setRunning ---
test('J3 M2: setRunning toggles the floating toolbar submit button', () => {
  const js = read('frontend/app.js');
  const body = js.slice(js.indexOf('function setRunning'), js.indexOf('function kvOrList'));
  assert.ok(body.includes(".glass-toolbar button[type=submit]"), 'setRunning must toggle the toolbar button');
  assert.equal((js.match(/setRunning\(false\)/g) || []).length, 2, 'both re-enable exits must still exist');
});

// --- M1: elapsed timer on all runs + visible stream-retry note ---
test('J3 M1: elapsed timer is shown on non-race runs too; stream retry is disclosed', () => {
  const js = read('frontend/app.js');
  assert.ok(!js.includes("race ? `Running live…"), 'timer must no longer be race-gated');
  assert.ok(js.includes('retrying once via the standard path'));
  assert.ok(js.includes('never a second verdict') || js.includes('not a second verdict'));
});

// --- M7: city-preferring venue choice ---
test('J3 M7: a venue in the offer city wins over an earlier same-named venue elsewhere', () => {
  const body = { _embedded: { venues: [
    { name: 'Test Room', city: { name: 'Elsewhere' } },
    { name: 'Test Room', city: { name: 'New York' } },
  ] } };
  assert.equal(extractVenueForCity(body, 'New York').city.name, 'New York');
  assert.equal(extractVenueForCity(body, 'new york').city.name, 'New York');
});

test('J3 M7: no city match -> first result exactly as before; empty -> null', () => {
  const body = { _embedded: { venues: [
    { name: 'First Room', city: { name: 'Elsewhere' } },
    { name: 'Second Room', city: 'Elsewhere' },
  ] } };
  assert.equal(extractVenueForCity(body, 'New York').name, 'First Room');
  assert.equal(extractVenueForCity({ _embedded: { venues: [] } }, 'New York'), null);
  assert.equal(extractVenueForCity({}, 'New York'), null);
});

test('J3 M7: venueCityOf reads object and string city shapes, never guesses', () => {
  assert.equal(venueCityOf({ city: { name: 'New York' } }), 'New York');
  assert.equal(venueCityOf({ city: 'New York' }), 'New York');
  assert.equal(venueCityOf({ address: { city: 'Boston' } }), 'Boston');
  assert.equal(venueCityOf({ name: 'No City Room' }), null);
});

// --- Negative-price minor: Ticketmaster negative prices are absent, not corrupting ---
test('J3 minor: negative Ticketmaster price range is treated as absent', () => {
  const neg = { _embedded: { events: [{ priceRanges: [{ min: -50, max: -10, currency: 'USD' }] }] } };
  assert.equal(extractPrice(neg), null);
  const mixed = { _embedded: { events: [
    { priceRanges: [{ min: -50, max: 100, currency: 'USD' }] },
    { priceRanges: [{ min: 100, max: 140, currency: 'USD' }] },
  ] } };
  assert.equal(extractPrice(mixed).price, 120);
});
