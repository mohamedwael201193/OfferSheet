// S1 — verdict gating (pipeline with injected test deps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, baseConfig, mcpFixture } from './fixtures.js';

test('S1: full evidence renders a verdict with receipts and a miss trial', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.tickets, 2084);
  assert.equal(v.openers.topPick, 'Test Opener One');
  assert.equal(v.arms.gut.status, 'ok');
  assert.equal(v.arms.web.status, 'ok');
  assert.equal(v.missTrial.misses.length, 1);
  assert.equal(v.missTrial.misses[0].arm, 'gut');
  assert.ok(Array.isArray(v.receipts) && v.receipts.length >= 10, 'every leg must leave a receipt');
  for (const r of v.receipts) {
    assert.ok(r.claim && r.operation, 'receipt needs claim + operation');
    assert.ok(r.resultCount !== null && r.resultCount !== undefined, 'receipt needs a resultCount');
  }
  const replayable = v.receipts.filter((r) => r.replay);
  assert.ok(replayable.length >= 10, 'verdict receipts must carry replay data');
});

test('S1: no key throws NOT_CONFIGURED before any verdict number exists', async () => {
  const deps = baseDeps({ config: baseConfig({ qlooKeyConfigured: false }) });
  await assert.rejects(
    () => runVerdict(baseInput(), deps),
    (e) => e.code === 'NOT_CONFIGURED' && e.status === 503,
  );
});

test('S1: a failed required leg withholds the verdict with NO numbers', async () => {
  const deps = baseDeps({
    mcpCall: mcpFixture({ qloo_where_popular: new Error('test leg failure') }),
  });
  const v = await runVerdict(baseInput(), deps);
  assert.equal(v.status, 'verdict_withheld');
  assert.ok(v.missingLegs.includes('where_popular'));
  assert.ok(!('breakEven' in v), 'no break-even number may render from partial evidence');
  assert.ok(!('audience' in v), 'no audience number may render from partial evidence');
  assert.ok(!('openers' in v), 'no picks may render from partial evidence');
});

test('S1: a failed readiness probe fails closed (throws, no verdict object)', async () => {
  const deps = baseDeps({
    mcpCall: mcpFixture({ qloo_capabilities: new Error('test transport failure') }),
  });
  await assert.rejects(() => runVerdict(baseInput(), deps), /test transport failure/);
});

test('S1: a failed OPTIONAL leg (trends) still renders the verdict', async () => {
  const deps = baseDeps({
    mcpCall: mcpFixture({ qloo_trends: new Error('test trends failure') }),
  });
  const v = await runVerdict(baseInput(), deps);
  assert.equal(v.status, 'verdict');
  assert.equal(v.legs.trends.status, 'error');
  assert.equal(v.breakEven.tickets, 2084);
});

test('S1: ambiguous headliner returns needs_input candidates, never a guess', async () => {
  const deps = baseDeps({
    mcpCall: mcpFixture({
      qloo_describe: {
        status: 'needs_input',
        results: [
          { id: 'test-a', name: 'Billie Eilish (singer)' },
          { id: 'test-b', name: 'Billie Eilish (album)' },
        ],
      },
    }),
  });
  const v = await runVerdict(baseInput(), deps);
  assert.equal(v.status, 'needs_input');
  assert.equal(v.candidates.length, 2);
  assert.ok(!('breakEven' in v), 'no verdict may render from an ambiguous headliner');
});
