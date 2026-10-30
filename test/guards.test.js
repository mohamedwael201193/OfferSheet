// T03 (guard logic, unit) + T12 (monthly floor trip) + T13 (per-visitor cap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Guards } from '../backend/src/guards.js';

test('T03: per-run cap counts calls and resets on resetRun', () => {
  const g = new Guards({ monthlyBudget: 1500, perVisitorDailyCap: 20, perRunCallCap: 2 });
  g.checkCall();
  g.checkCall();
  assert.throws(() => g.checkCall(), (e) => e.code === 'RUN_CAP' && e.status === 503);
  g.resetRun();
  g.checkCall(); // no throw after reset
});

test('T12: monthly floor trips fail-closed with QUOTA_FLOOR 503', () => {
  const g = new Guards({ monthlyBudget: 2, perVisitorDailyCap: 20, perRunCallCap: 40 });
  g.checkCall();
  g.checkCall();
  assert.throws(() => g.checkCall(), (e) => e.code === 'QUOTA_FLOOR' && e.status === 503);
});

test('T12: month rollover resets the monthly count', () => {
  const g = new Guards({ monthlyBudget: 1, perVisitorDailyCap: 20, perRunCallCap: 40 });
  g.checkCall();
  assert.throws(() => g.checkCall(), (e) => e.code === 'QUOTA_FLOOR');
  g.monthKey = '2000-01'; // force a new month
  g.checkCall(); // no throw after rollover
});

test('T13: per-visitor daily cap trips with VISITOR_CAP 429, per IP', () => {
  const g = new Guards({ monthlyBudget: 1500, perVisitorDailyCap: 2, perRunCallCap: 40 });
  g.checkVisitor('1.2.3.4');
  g.checkVisitor('1.2.3.4');
  assert.throws(() => g.checkVisitor('1.2.3.4'), (e) => e.code === 'VISITOR_CAP' && e.status === 429);
  g.checkVisitor('5.6.7.8'); // a different visitor is unaffected
});

test('T03: snapshot reports the adopted design settings (labeled, not Qloo quotas)', () => {
  const g = new Guards({ monthlyBudget: 1500, perVisitorDailyCap: 20, perRunCallCap: 40 });
  const s = g.snapshot();
  assert.equal(s.monthlyBudget, 1500);
  assert.equal(s.perVisitorDailyCap, 20);
  assert.equal(s.perRunCallCap, 40);
});
