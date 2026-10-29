// D5 — Quota guards tripping EXACTLY at thresholds (MAX §3 T03/T12/T13):
// each guard allows exactly N calls and trips on N+1, with the documented
// code + status; month rollover resets the monthly count; per-run reset
// restores only the per-run count; visitor counts are keyed per day (a stale
// day's count never counts toward today). Plus pipeline wiring: a tripped
// guard fails the whole verdict closed, before any partial verdict exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Guards } from '../backend/src/guards.js';
import { visitorCapTripped } from '../backend/src/errors.js';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, mcpFixture } from './fixtures.js';

test('D5: monthly floor allows exactly N calls, trips on N+1, count frozen at N', () => {
  const g = new Guards({ monthlyBudget: 3, perVisitorDailyCap: 20, perRunCallCap: 40 });
  g.checkCall(); g.checkCall(); g.checkCall();
  assert.throws(() => g.checkCall(), (e) => e.code === 'QUOTA_FLOOR' && e.status === 503);
  assert.equal(g.monthlyCount, 3);
});

test('D5: monthly budget 0 allows zero calls', () => {
  const g = new Guards({ monthlyBudget: 0, perVisitorDailyCap: 20, perRunCallCap: 40 });
  assert.throws(() => g.checkCall(), (e) => e.code === 'QUOTA_FLOOR' && e.status === 503);
  assert.equal(g.monthlyCount, 0);
});

test('D5: month rollover resets, then the new month trips again at exactly N', () => {
  const g = new Guards({ monthlyBudget: 1, perVisitorDailyCap: 20, perRunCallCap: 40 });
  g.checkCall();
  assert.throws(() => g.checkCall(), (e) => e.code === 'QUOTA_FLOOR');
  g.monthKey = '2000-01';
  g.checkCall();
  assert.throws(() => g.checkCall(), (e) => e.code === 'QUOTA_FLOOR');
  assert.equal(g.monthlyCount, 1);
});

test('D5: per-visitor cap allows exactly N calls per IP, trips on N+1, other IPs unaffected', () => {
  const g = new Guards({ monthlyBudget: 1500, perVisitorDailyCap: 3, perRunCallCap: 40 });
  g.checkVisitor('1.2.3.4'); g.checkVisitor('1.2.3.4'); g.checkVisitor('1.2.3.4');
  assert.throws(() => g.checkVisitor('1.2.3.4'), (e) => e.code === 'VISITOR_CAP' && e.status === 429);
  g.checkVisitor('5.6.7.8');
});

test('D5: a stale day count never counts toward today (visitor counts are day-keyed)', () => {
  const g = new Guards({ monthlyBudget: 1500, perVisitorDailyCap: 2, perRunCallCap: 40 });
  g.visitorCounts.set('9.9.9.9:2000-01-01', 999);
  g.checkVisitor('9.9.9.9');
  g.checkVisitor('9.9.9.9');
  assert.throws(() => g.checkVisitor('9.9.9.9'), (e) => e.code === 'VISITOR_CAP');
});

test('D5: per-run cap allows exactly N calls, trips on N+1, resetRun restores only per-run', () => {
  const g = new Guards({ monthlyBudget: 1500, perVisitorDailyCap: 20, perRunCallCap: 3 });
  g.checkCall(); g.checkCall(); g.checkCall();
  assert.throws(() => g.checkCall(), (e) => e.code === 'RUN_CAP' && e.status === 503);
  const monthlyBefore = g.monthlyCount;
  g.resetRun();
  g.checkCall();
  assert.equal(g.monthlyCount, monthlyBefore + 1, 'resetRun must not reset the monthly count');
  assert.equal(g.perRunCount, 1);
});

test('D5: pipeline with a 3-call per-run cap fails closed with RUN_CAP mid-run', async () => {
  const guards = new Guards({ monthlyBudget: 1500, perVisitorDailyCap: 20, perRunCallCap: 3 });
  let mcpCalls = 0;
  const countingMcp = mcpFixture();
  const deps = baseDeps({
    guards,
    checkCall: () => guards.checkCall(),
    mcpCall: async (tool, args) => { mcpCalls += 1; return countingMcp(tool, args); },
  });
  // Call order: capabilities(1), find_tags(2), describe(3), recommend trips.
  await assert.rejects(
    () => runVerdict(baseInput(), deps),
    (e) => e.code === 'RUN_CAP' && e.status === 503,
  );
  assert.equal(mcpCalls, 3, 'the 4th call must trip before any MCP call is made for it');
});

test('D5: pipeline with a 5-call per-run cap fails closed with RUN_CAP on a late leg, not withheld', async () => {
  // Regression for a real bug this file exposed: guard trips after the
  // readiness probe were swallowed by leg try/catch blocks and downgraded
  // to a 200 verdict_withheld. They must surface as the guard's 503.
  // Call order: capabilities(1), find_tags(2), describe(3), recommend(4),
  // rank(5), where_popular trips on the 6th checkCall.
  const guards = new Guards({ monthlyBudget: 1500, perVisitorDailyCap: 20, perRunCallCap: 5 });
  let mcpCalls = 0;
  const countingMcp = mcpFixture();
  const deps = baseDeps({
    guards,
    checkCall: () => guards.checkCall(),
    mcpCall: async (tool, args) => { mcpCalls += 1; return countingMcp(tool, args); },
  });
  await assert.rejects(
    () => runVerdict(baseInput(), deps),
    (e) => e.code === 'RUN_CAP' && e.status === 503,
  );
  assert.equal(mcpCalls, 5, 'no live call may happen after the per-run trip');
});

test('D5: pipeline with a 5-call monthly budget fails closed with QUOTA_FLOOR on a late leg', async () => {
  const guards = new Guards({ monthlyBudget: 5, perVisitorDailyCap: 20, perRunCallCap: 40 });
  let mcpCalls = 0;
  const countingMcp = mcpFixture();
  const deps = baseDeps({
    guards,
    checkCall: () => guards.checkCall(),
    mcpCall: async (tool, args) => { mcpCalls += 1; return countingMcp(tool, args); },
  });
  await assert.rejects(
    () => runVerdict(baseInput(), deps),
    (e) => e.code === 'QUOTA_FLOOR' && e.status === 503,
  );
  assert.equal(mcpCalls, 5, 'no live call may happen after the floor trip');
});

test('D5: pipeline with a 0 monthly budget fails closed before any MCP call', async () => {
  const guards = new Guards({ monthlyBudget: 0, perVisitorDailyCap: 20, perRunCallCap: 40 });
  let mcpCalls = 0;
  const countingMcp = mcpFixture();
  const deps = baseDeps({
    guards,
    checkCall: () => guards.checkCall(),
    mcpCall: async (tool, args) => { mcpCalls += 1; return countingMcp(tool, args); },
  });
  await assert.rejects(
    () => runVerdict(baseInput(), deps),
    (e) => e.code === 'QUOTA_FLOOR' && e.status === 503,
  );
  assert.equal(mcpCalls, 0, 'no live call may happen once the floor is tripped');
});

test('D5: pipeline with a tripped visitor cap fails closed before any MCP call', async () => {
  let mcpCalls = 0;
  const countingMcp = mcpFixture();
  const deps = baseDeps({
    checkVisitor: () => { throw visitorCapTripped(); },
    mcpCall: async (tool, args) => { mcpCalls += 1; return countingMcp(tool, args); },
  });
  await assert.rejects(
    () => runVerdict(baseInput({ visitorIp: '1.2.3.4' }), deps),
    (e) => e.code === 'VISITOR_CAP' && e.status === 429,
  );
  assert.equal(mcpCalls, 0, 'a capped visitor must not trigger any live call');
});
