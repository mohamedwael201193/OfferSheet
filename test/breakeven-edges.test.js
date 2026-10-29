// D1 — Break-even arithmetic edges beyond T01: zero / negative / huge values.
// Pure unit tests, no network. Huge case: guarantee 10^12 must stay exact
// (well below 2^53) and ceil correctly; every non-positive net must throw
// instead of dividing by zero; non-numeric inputs must throw, never coerce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakEven, canBreakEven } from '../backend/src/breakeven.js';

test('D1: huge guarantee 10^12 divides and ceils exactly', () => {
  // 10^12 / 120 = 8333333333.33... -> 8333333334
  assert.equal(breakEven({ guarantee: 1e12, ticketPrice: 120 }).tickets, 8333333334);
  // 10^12 / 45 = 22222222222.22... -> 22222222223
  assert.equal(breakEven({ guarantee: 1e12, ticketPrice: 50, variableCost: 5 }).tickets, 22222222223);
  // 10^12 / 10^9 = 1000 exactly, no rounding up
  assert.equal(breakEven({ guarantee: 1e12, ticketPrice: 1e9 }).tickets, 1000);
});

test('D1: tiny ticket price scales up without overflow', () => {
  assert.equal(breakEven({ guarantee: 100, ticketPrice: 0.01 }).tickets, 10000);
});

test('D1: zero ticket price throws, never divides by zero', () => {
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: 0 }), /net per-ticket contribution must be positive/);
  assert.throws(() => breakEven({ guarantee: 0, ticketPrice: 0 }), /net per-ticket contribution must be positive/);
});

test('D1: negative ticket price throws', () => {
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: -50 }), /net per-ticket contribution must be positive/);
});

test('D1: non-numeric ticket price throws, never coerces', () => {
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: '50' }), /ticket price must be a number/);
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: NaN }), /ticket price must be a number/);
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: Infinity }), /ticket price must be a number/);
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: undefined }), /ticket price is required/);
});

test('D1: negative variable cost throws; cost equal to or above price throws', () => {
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: 50, variableCost: -1 }), /variable cost must be >= 0/);
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: 50, variableCost: 50 }), /net per-ticket contribution must be positive/);
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: 50, variableCost: 60 }), /net per-ticket contribution must be positive/);
});

test('D1: non-numeric guarantee throws, never coerces', () => {
  assert.throws(() => breakEven({ guarantee: NaN, ticketPrice: 50 }), /guarantee must be >= 0/);
  assert.throws(() => breakEven({ guarantee: Infinity, ticketPrice: 50 }), /guarantee must be >= 0/);
  assert.throws(() => breakEven({ guarantee: '100', ticketPrice: 50 }), /guarantee must be >= 0/);
  assert.throws(() => breakEven({ guarantee: undefined, ticketPrice: 50 }), /guarantee must be >= 0/);
});

test('D1: guarantee 0 with zero capacity still yields 0 tickets, no verdict', () => {
  const r = breakEven({ guarantee: 0, ticketPrice: 50, capacity: 0 });
  assert.equal(r.tickets, 0);
  assert.equal(r.note, 'no guarantee');
  assert.equal(r.verdict, null);
});

test('D1: capacity exactly equal to break-even is breakable; one less is not', () => {
  // 250000 / 120 = 2083.33... -> 2084 tickets
  const at = breakEven({ guarantee: 250000, ticketPrice: 120, capacity: 2084 });
  assert.equal(at.tickets, 2084);
  assert.equal(at.verdict, null);
  assert.equal(canBreakEven(at, 2084), true);
  const under = breakEven({ guarantee: 250000, ticketPrice: 120, capacity: 2083 });
  assert.equal(under.tickets, 2084);
  assert.equal(under.verdict, 'Cannot break even in this room at this guarantee');
  assert.equal(canBreakEven(under, 2083), false);
});

test('D1: unknown capacity yields null from canBreakEven, never a guess', () => {
  const r = breakEven({ guarantee: 250000, ticketPrice: 120, capacity: null });
  assert.equal(r.verdict, null);
  assert.equal(canBreakEven(r, null), null);
  assert.equal(canBreakEven(r, undefined), null);
});

test('D1: fractional guarantee ceils like any other remainder', () => {
  assert.equal(breakEven({ guarantee: 100.5, ticketPrice: 50 }).tickets, 3);
});
