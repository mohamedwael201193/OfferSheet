// T01 — Break-even arithmetic (unit, no network).
// Spec: break-even tickets = ceil(guarantee / net per-ticket contribution),
// net = ticket price - variable cost per ticket.
// Edges (MAX §2.6/§3 T01): zero/negative net -> error, never division by zero;
// guarantee 0 -> 0 tickets with a note; break-even > known capacity -> "cannot break even".
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakEven, canBreakEven } from '../backend/src/breakeven.js';

test('exact division needs no extra ticket', () => {
  assert.equal(breakEven({ guarantee: 9000, ticketPrice: 50, variableCost: 5 }).tickets, 200);
});

test('remainder rounds up (ceil)', () => {
  // 20000 / 45 = 444.44... -> 445
  assert.equal(breakEven({ guarantee: 20000, ticketPrice: 50, variableCost: 5 }).tickets, 445);
});

test('zero guarantee -> 0 tickets with note', () => {
  const r = breakEven({ guarantee: 0, ticketPrice: 50, variableCost: 5 });
  assert.equal(r.tickets, 0);
  assert.equal(r.note, 'no guarantee');
});

test('zero or negative net -> error, never division by zero', () => {
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: 5, variableCost: 5 }), /net per-ticket contribution must be positive/);
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: 5, variableCost: 10 }), /net per-ticket contribution must be positive/);
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: 0, variableCost: 0 }), /net per-ticket contribution must be positive/);
});

test('negative guarantee -> error', () => {
  assert.throws(() => breakEven({ guarantee: -1, ticketPrice: 50, variableCost: 5 }), /guarantee must be >= 0/);
});

test('break-even exceeding known capacity -> cannot break even', () => {
  const r = breakEven({ guarantee: 100000, ticketPrice: 50, variableCost: 5, capacity: 100 });
  assert.equal(r.tickets, 2223);
  assert.equal(canBreakEven(r, 100), false);
  assert.equal(r.verdict, 'Cannot break even in this room at this guarantee');
});

test('break-even within capacity -> can break even', () => {
  const r = breakEven({ guarantee: 9000, ticketPrice: 50, variableCost: 5, capacity: 500 });
  assert.equal(canBreakEven(r, 500), true);
  assert.equal(r.verdict, null);
});

test('missing price -> price unknown, no invented number', () => {
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: null, variableCost: 0 }), /ticket price is required/);
});
