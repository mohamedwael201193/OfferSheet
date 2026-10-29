// D6 — Verdict-gating matrix beyond S1: EVERY required leg failing alone
// withholds the verdict, and the withheld response carries NO verdict-number
// fields (no breakEven, audience, openers, or capacity objects; no "tickets"
// key anywhere). "No numbers" here means no verdict numbers: the withheld
// response still carries diagnostics (timingMs, receipt resultCounts) by
// design — those are audit data, not verdict numbers, and this file asserts
// the boundary explicitly. Paired legs use OR logic: one survivor keeps the
// verdict alive. Optional legs never block it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, mcpFixture, restFixture } from './fixtures.js';

function assertWithheld(v, missing) {
  assert.equal(v.status, 'verdict_withheld');
  for (const leg of missing) assert.ok(v.missingLegs.includes(leg), `missingLegs must include ${leg}`);
  assert.ok(!('breakEven' in v), 'no break-even number may render from partial evidence');
  assert.ok(!('audience' in v), 'no audience number may render from partial evidence');
  assert.ok(!('openers' in v), 'no picks may render from partial evidence');
  assert.ok(!('capacity' in v), 'no capacity may render from partial evidence');
  assert.ok(!(/"tickets"\s*:/.test(JSON.stringify(v))), 'no tickets key may appear in a withheld response');
  assert.ok(!(/"breakEven"\s*:/.test(JSON.stringify(v))), 'no breakEven key may appear in a withheld response');
}

function err(tool) {
  return { [tool]: new Error(`test leg failure: ${tool}`) };
}

test('D6: failed where_popular alone withholds the verdict', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_where_popular')) }));
  assertWithheld(v, ['where_popular']);
});

test('D6: failed demographics alone withholds the verdict', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_audience_demographics')) }));
  assertWithheld(v, ['demographics']);
});

test('D6: failed resolve (find_tags AND describe) withholds the verdict', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({ ...err('qloo_find_tags'), ...err('qloo_describe') }),
  }));
  assertWithheld(v, ['resolve (find_tags/describe)']);
});

test('D6: failed recommend (rank skipped) withholds the verdict', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_recommend')) }));
  assertWithheld(v, ['rank-or-recommend']);
  assert.equal(v.legs.rank.status, 'skipped');
});

test('D6: failed overlap (compare AND entity_tags) withholds the verdict', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({ ...err('qloo_compare_audiences'), ...err('qloo_entity_tags') }),
  }));
  assertWithheld(v, ['compare-or-entity_tags']);
});

test('D6: all required legs failing withholds with all five missing entries', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({
      ...err('qloo_find_tags'), ...err('qloo_describe'), ...err('qloo_recommend'),
      ...err('qloo_where_popular'), ...err('qloo_audience_demographics'),
      ...err('qloo_compare_audiences'), ...err('qloo_entity_tags'),
    }),
  }));
  assertWithheld(v, ['resolve (find_tags/describe)', 'rank-or-recommend', 'where_popular', 'demographics', 'compare-or-entity_tags']);
  assert.equal(v.missingLegs.length, 5);
});

test('D6: withheld response keeps diagnostics but no verdict numbers (boundary)', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_where_popular')) }));
  assert.equal(v.status, 'verdict_withheld');
  assert.ok(typeof v.timingMs === 'number', 'timing diagnostics are allowed');
  assert.ok(Array.isArray(v.receipts) && v.receipts.length > 0, 'receipt audit trail is allowed');
  assert.ok(!('breakEven' in v) && !('audience' in v), 'but no verdict numbers');
});

test('D6: find_tags failing alone does NOT withhold (describe survives)', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_find_tags')) }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.legs.findTags.status, 'error');
});

test('D6: describe failing alone does NOT withhold (find_tags survives)', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_describe')) }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.legs.describe.status, 'error');
});

test('D6: rank failing alone does NOT withhold (recommend survives)', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_rank')) }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.legs.rank.status, 'error');
  assert.equal(v.openers.topPick, 'Test Opener One');
});

test('D6: compare failing alone does NOT withhold (entity_tags survives)', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_compare_audiences')) }));
  assert.equal(v.status, 'verdict');
});

test('D6: entity_tags failing alone does NOT withhold (compare survives)', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: mcpFixture(err('qloo_entity_tags')) }));
  assert.equal(v.status, 'verdict');
});

test('D6: failed trends AND failed REST search still render the verdict', async () => {
  const rf = restFixture();
  const deps = baseDeps({
    mcpCall: mcpFixture(err('qloo_trends')),
    restCall: async (arg) => {
      if (arg.path === '/search') throw new Error('test REST search failure');
      return rf(arg);
    },
  });
  const v = await runVerdict(baseInput(), deps);
  assert.equal(v.status, 'verdict');
  assert.equal(v.legs.trends.status, 'error');
  assert.equal(v.legs.restSearch.status, 'error');
  assert.equal(v.breakEven.tickets, 2084);
});

test('D6: needs_input returns before any ranking call (no guess, no further work)', async () => {
  const seen = [];
  const inner = mcpFixture({
    qloo_describe: { status: 'needs_input', results: [{ id: 'test-a', name: 'Billie Eilish (singer)' }] },
  });
  const deps = baseDeps({
    mcpCall: async (tool, args) => { seen.push(tool); return inner(tool, args); },
  });
  const v = await runVerdict(baseInput(), deps);
  assert.equal(v.status, 'needs_input');
  assert.deepEqual(seen, ['qloo_capabilities', 'qloo_find_tags', 'qloo_describe']);
});
