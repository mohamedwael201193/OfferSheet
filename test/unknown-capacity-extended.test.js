// D7 — Unknown-capacity rendering, extended beyond T11: ZERO sellout /
// room-fill / percentage keys anywhere in the unknown-capacity verdict
// response (the exact §2.6 wording is prose, not a field — the key scan is
// what proves no percentage renders). Plus pipeline-level over-capacity,
// user-beats-Ticketmaster precedence, and capacity-extraction edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCapacity } from '../backend/src/ticketmaster.js';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, tmEventsWithCapacity } from './fixtures.js';

const UNKNOWN_WORDING = 'Venue capacity unknown — Ticketmaster returned no capacity for this room. Break-even is shown as tickets needed, not as a sellout percentage. Verify room size before signing.';

function collectKeys(obj, out = new Set()) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

const BANNED_KEY_PARTS = ['sellout', 'roomfill', 'room_fill', 'fillrate', 'fillpct', 'occupancy', 'willsellout', 'percent'];

test('D7: unknown-capacity verdict has ZERO sellout/room-fill/percentage keys', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.capacity.state, 'unknown');
  assert.equal(v.capacity.value, null);
  assert.equal(v.capacity.message, UNKNOWN_WORDING);
  assert.equal(v.breakEven.tickets, 2084, 'tickets needed still renders');
  const keys = collectKeys(v);
  for (const k of keys) {
    const low = k.toLowerCase();
    for (const part of BANNED_KEY_PARTS) {
      assert.ok(!low.includes(part), `banned key part "${part}" found in key "${k}"`);
    }
  }
  const json = JSON.stringify(v);
  assert.ok(!(/"sellout[^"]*"\s*:/i.test(json)), 'no sellout key in serialized response');
  assert.ok(!(/"roomfill[^"]*"\s*:/i.test(json)), 'no roomFill key in serialized response');
});

test('D7: unknown-capacity verdict carries no numeric percentage value anywhere', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  // The only prose mentioning a percentage is the §2.6 wording itself, which
  // says the break-even is NOT shown as one. No field may carry a % value.
  assert.ok(!JSON.stringify(v).includes('%'), 'no % character may appear in the response payload');
});

test('D7: known capacity above break-even keeps tickets + no cannot verdict', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ tmEvents: tmEventsWithCapacity(5000) }));
  assert.equal(v.capacity.state, 'known');
  assert.equal(v.breakEven.tickets, 2084);
  assert.equal(v.breakEven.verdict, null);
});

test('D7: user capacity beats Ticketmaster capacity, labeled user-supplied', async () => {
  const v = await runVerdict(baseInput({ capacity: 3000 }), baseDeps({ tmEvents: tmEventsWithCapacity(5000) }));
  assert.equal(v.capacity.value, 3000);
  assert.equal(v.capacity.source, 'user-supplied, not Ticketmaster-verified');
});

test('D7: capacity extraction rejects zero / NaN / Infinity / string capacities', () => {
  assert.equal(extractCapacity({ capacity: 0 }), null);
  assert.equal(extractCapacity({ capacity: NaN }), null);
  assert.equal(extractCapacity({ capacity: Infinity }), null);
  assert.equal(extractCapacity({ capacity: '5000' }), null);
  assert.equal(extractCapacity({ capacity: undefined }), null);
  assert.equal(extractCapacity({ seatingCapacity: 0 }), null);
});

test('D7: capacity extraction accepts generalInfo capacity', () => {
  assert.equal(extractCapacity({ generalInfo: { capacity: 4200 } }), 4200);
});
