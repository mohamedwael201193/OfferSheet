// G4 (superiority): insights + compare REST legs surface their
// already-fetched payloads (no new call). Previously both legs built
// {} — a receipted leg carrying no data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, mcpFixture } from './fixtures.js';

test('G4: insights leg surfaces its fetched entities; compare leg surfaces its fetched body', async () => {
  const comparisonBody = { overlap: 'test-comparison-object', shared: ['test-tag'] };
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({
      qloo_find_tags: { status: 'ok', results: [{ id: 'urn:tag:celebrity_spokesperson:qloo:billie_eilish', name: 'Billie Eilish' }] },
    }),
    restCall: async ({ path }) => {
      if (path === '/v2/insights') {
        return { ok: true, status: 200, requestHash: 'h-insights', requestId: null, resultCount: 2, entities: [{ id: 'e1', name: 'E1' }, { id: 'e2', name: 'E2' }] };
      }
      if (path === '/v2/analysis/compare') {
        return { ok: true, status: 200, requestHash: 'h-cmp', requestId: null, resultCount: null, entities: [], payloadPresent: true, body: comparisonBody };
      }
      return { ok: true, status: 200, requestHash: 'test-hash', requestId: null, resultCount: 0, entities: [] };
    },
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.tickets, 2084, 'payload surfacing must not change the arithmetic');
  assert.equal(v.legs.restInsights.status, 'ok');
  assert.deepEqual(v.legs.restInsights.entities, [{ id: 'e1', name: 'E1' }, { id: 'e2', name: 'E2' }]);
  assert.equal(v.legs.restCompare.status, 'ok');
  assert.deepEqual(v.legs.restCompare.comparison, comparisonBody);
});

test('G4: insights leg with an empty fetched list still surfaces an empty list (not a dropped field)', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({
      qloo_find_tags: { status: 'ok', results: [{ id: 'urn:tag:celebrity_spokesperson:qloo:billie_eilish', name: 'Billie Eilish' }] },
    }),
    restCall: async ({ path }) => {
      if (path === '/v2/insights') {
        return { ok: true, status: 200, requestHash: 'h-insights', requestId: null, resultCount: 3, entities: [] };
      }
      return { ok: true, status: 200, requestHash: 'test-hash', requestId: null, resultCount: 0, entities: [] };
    },
  }));
  assert.equal(v.legs.restInsights.status, 'ok');
  assert.deepEqual(v.legs.restInsights.entities, []);
});
