// D2 — Pipeline input validation + capacity-below-break-even at pipeline level.
// Missing / whitespace-only artist and city must be rejected (INVALID_INPUT,
// 400) before any verdict number exists; zero / negative capacity must fall
// through to the unknown-capacity state, never render as a capacity; a
// break-even above a known capacity must surface the honest "Cannot break
// even" verdict WITH its numbers (unlike a withheld verdict, which has none).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerdict } from '../backend/src/pipeline.js';
import {
  baseDeps, baseInput, mcpFixture, tmEventsWithCapacity,
} from './fixtures.js';

async function rejectsInvalid(input, pattern) {
  await assert.rejects(
    () => runVerdict(input, baseDeps()),
    (e) => e.code === 'INVALID_INPUT' && e.status === 400 && pattern.test(e.message),
  );
}

test('D2: missing / whitespace-only artist is rejected', async () => {
  for (const artist of [undefined, null, '', '   ', '\t\n']) {
    await rejectsInvalid(baseInput({ artist }), /artist is required/);
  }
});

test('D2: missing / whitespace-only city is rejected', async () => {
  for (const city of [undefined, null, '', '   ', '\t\n']) {
    await rejectsInvalid(baseInput({ city }), /city is required/);
  }
});

test('D2: non-string artist / city is rejected, never coerced', async () => {
  await rejectsInvalid(baseInput({ artist: 42 }), /artist is required/);
  await rejectsInvalid(baseInput({ city: 42 }), /city is required/);
});

test('D2: missing / non-finite / negative / string guarantee is rejected', async () => {
  for (const guarantee of [undefined, null, NaN, Infinity, -1, '250000']) {
    await rejectsInvalid(baseInput({ guarantee }), /guarantee must be a non-negative number/);
  }
});

test('D2: negative variableCost is rejected', async () => {
  await rejectsInvalid(baseInput({ variableCost: -10 }), /variableCost must be non-negative/);
});

test('D2: padded artist / city are trimmed, not rejected', async () => {
  const v = await runVerdict(baseInput({ artist: '  Billie Eilish  ', city: ' New York ' }), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.artist, 'Billie Eilish');
  assert.equal(v.city, 'New York');
});

test('D2: zero guarantee through the pipeline yields 0 tickets with the note', async () => {
  const v = await runVerdict(baseInput({ guarantee: 0 }), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.tickets, 0);
  assert.equal(v.breakEven.note, 'no guarantee');
});

test('D2: zero capacity input renders unknown, never capacity 0', async () => {
  const v = await runVerdict(baseInput({ capacity: 0 }), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.capacity.state, 'unknown');
  assert.equal(v.capacity.value, null);
});

test('D2: negative capacity input renders unknown, never a negative room', async () => {
  const v = await runVerdict(baseInput({ capacity: -500 }), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.capacity.state, 'unknown');
  assert.equal(v.capacity.value, null);
});

test('D2: zero user capacity defers to Ticketmaster-reported capacity', async () => {
  // G11 (intentional change, 2026-10-29): no venue entered, so the
  // first-event fallback label now carries the "not the offer room" suffix
  // (bare 'Ticketmaster-reported' is reserved for a resolved named room).
  const v = await runVerdict(baseInput({ capacity: 0 }), baseDeps({ tmEvents: tmEventsWithCapacity(5000) }));
  assert.equal(v.capacity.state, 'known');
  assert.equal(v.capacity.value, 5000);
  assert.equal(v.capacity.source, `Ticketmaster-reported — first matching Ticketmaster event's venue, not the offer room`);
});

test('D2: break-even above known capacity surfaces the honest verdict at pipeline level', async () => {
  const v = await runVerdict(baseInput({ capacity: 100 }), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.tickets, 2084);
  assert.equal(v.capacity.value, 100);
  assert.equal(v.breakEven.verdict, 'Cannot break even in this room at this guarantee');
});

test('D2: break-even exactly at known capacity has no cannot-break-even verdict', async () => {
  const v = await runVerdict(baseInput({ capacity: 2084 }), baseDeps());
  assert.equal(v.breakEven.tickets, 2084);
  assert.equal(v.breakEven.verdict, null);
});

test('D2: ambiguous headliner with zero candidates is still needs_input, never a guess', async () => {
  const deps = baseDeps({
    mcpCall: mcpFixture({ qloo_describe: { status: 'needs_input', results: [] } }),
  });
  const v = await runVerdict(baseInput(), deps);
  assert.equal(v.status, 'needs_input');
  assert.deepEqual(v.candidates, []);
  assert.ok(!('breakEven' in v), 'no verdict may render from an ambiguous headliner');
  assert.ok(!('audience' in v), 'no audience may render from an ambiguous headliner');
  assert.ok(!('openers' in v), 'no picks may render from an ambiguous headliner');
  assert.ok(!('capacity' in v), 'no capacity may render from an ambiguous headliner');
});
