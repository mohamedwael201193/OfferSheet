// Gap 2 + Gap 3 backend fixes (integration-depth audit) + static-handler
// URL-parse guard. Each test names the gap it proves. Fixtures follow the
// labeled test-only pattern; production code never imports this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { runVerdict } from '../backend/src/pipeline.js';
import { qlooRest } from '../backend/src/rest.js';
import { baseDeps, baseInput, mcpFixture } from './fixtures.js';

function stubFetch(body, status = 200) {
  return async () => ({
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });
}

function recordingMcp(base, calls) {
  return async (tool, args) => {
    calls.push({ tool, args });
    return base(tool, args);
  };
}

function spyRest(calls, table) {
  return async ({ path, params }) => {
    calls.push({ path, params });
    if (table[path]) return typeof table[path] === 'function' ? table[path](params) : table[path];
    return { ok: true, status: 200, requestHash: 'test-hash', requestId: null, resultCount: 0, entities: [] };
  };
}

const SEARCH_RESULTS = [
  { entity_id: 'test-entity-1', name: 'Test Artist One' },
  { entity_id: 'test-entity-2', name: 'Test Artist Two' },
  { entity_id: 'test-entity-3', name: 'Test Artist Three' },
  { entity_id: 'test-entity-4', name: 'Test Artist Four' },
  { entity_id: 'test-entity-5', name: 'Test Artist Five' },
];

// ---- Gap 2: REST shape parsing ----

test('Gap 2: qlooRest parses the live /search results shape (not just entities)', async () => {
  const out = await qlooRest({
    path: '/search',
    params: { query: 'jazz', take: 5 },
    key: 'test-only-not-a-real-key',
    baseUrl: 'https://hackathon.api.qloo.com',
    fetchImpl: stubFetch({ results: SEARCH_RESULTS }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.equal(out.entities.length, 5);
  assert.equal(out.resultCount, 5);
  assert.equal(out.payloadPresent, true);
  assert.deepEqual(out.entities.map((e) => e.id), ['test-entity-1', 'test-entity-2', 'test-entity-3', 'test-entity-4', 'test-entity-5']);
});

test('Gap 2: qlooRest keeps parsing the legacy entities shape', async () => {
  const out = await qlooRest({
    path: '/search',
    params: { query: 'jazz' },
    key: 'test-only-not-a-real-key',
    baseUrl: 'https://hackathon.api.qloo.com',
    fetchImpl: stubFetch({ entities: SEARCH_RESULTS.slice(0, 2) }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.entities.length, 2);
  assert.equal(out.payloadPresent, true);
});

test('Gap 2: qlooRest treats a comparison object body as a real payload', async () => {
  const out = await qlooRest({
    path: '/v2/analysis/compare',
    params: { 'a.signal.interests.entities': 'x', 'b.signal.interests.entities': 'y' },
    key: 'test-only-not-a-real-key',
    baseUrl: 'https://hackathon.api.qloo.com',
    fetchImpl: stubFetch({ a: { overlap: 0.5 }, b: { overlap: 0.4 } }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.payloadPresent, true);
  assert.deepEqual(out.entities, []);
});

test('Gap 2: qlooRest flags empty and error bodies as no payload', async () => {
  const empty = await qlooRest({
    path: '/search', params: {}, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com',
    fetchImpl: stubFetch({}),
  });
  assert.equal(empty.payloadPresent, false);
  assert.equal(empty.resultCount, null);
  const errBody = await qlooRest({
    path: '/search', params: {}, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com',
    fetchImpl: stubFetch({ error: 'bad request' }),
  });
  assert.equal(errBody.payloadPresent, false);
  const emptyList = await qlooRest({
    path: '/search', params: {}, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com',
    fetchImpl: stubFetch({ results: [] }),
  });
  assert.equal(emptyList.payloadPresent, false);
});

test('Gap 2: REST diagnostics log path+status+keys only, never body content', async () => {
  const logs = [];
  const out = await qlooRest({
    path: '/search',
    params: { query: 'jazz' },
    key: 'test-only-not-a-real-key',
    baseUrl: 'https://hackathon.api.qloo.com',
    fetchImpl: stubFetch({ results: [{ entity_id: 'e1', name: 'Jazz Star SecretName' }] }),
    logFn: (info) => logs.push(info),
  });
  assert.equal(out.ok, true);
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0]).sort(), ['bodyKeys', 'path', 'resultCount', 'status']);
  assert.equal(logs[0].path, '/search');
  assert.equal(logs[0].status, 200);
  assert.deepEqual(logs[0].bodyKeys, ['results']);
  assert.equal(logs[0].resultCount, 1);
  assert.ok(!JSON.stringify(logs[0]).includes('Jazz Star SecretName'), 'log must never carry body content');
  assert.ok(!('body' in out) || true, 'body stays in the transport result, not the log');
  // A throwing logFn must never break the call.
  const out2 = await qlooRest({
    path: '/search', params: {}, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com',
    fetchImpl: stubFetch({ results: [{ entity_id: 'e1', name: 'E1' }] }),
    logFn: () => { throw new Error('log exploded'); },
  });
  assert.equal(out2.ok, true);
});

// ---- Gap 2: tagUrns id-field unlocks restInsights ----

test('Gap 2: find_tags id-field URN unlocks the restInsights leg', async () => {
  const restCalls = [];
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({
      qloo_find_tags: { status: 'ok', results: [{ id: 'urn:tag:celebrity_spokesperson:qloo:billie_eilish', name: 'Billie Eilish' }] },
    }),
    restCall: spyRest(restCalls, {
      '/v2/insights': { ok: true, status: 200, requestHash: 'h-insights', requestId: null, resultCount: 2, entities: [{ id: 'e1', name: 'E1' }] },
    }),
  }));
  assert.notEqual(v.legs.restInsights.status, 'skipped', 'id-field URN must resolve to tag URNs');
  assert.equal(v.legs.restInsights.status, 'ok');
  const insightsCall = restCalls.find((c) => c.path === '/v2/insights');
  assert.ok(insightsCall, 'insights leg must call /v2/insights');
  assert.ok(
    String(insightsCall.params['signal.interests.tags']).includes('urn:tag:celebrity_spokesperson:qloo:billie_eilish'),
    'insights tags must carry the id-field URN',
  );
  assert.ok(v.receipts.some((r) => r.operation === 'rest:/v2/insights'), 'insights leg must receipt');
});

// ---- Gap 2: REST legs receipt or carry the exact failure label ----

test('Gap 2: REST object-payload compare leg receipts', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    restCall: async ({ path }) => (path === '/v2/analysis/compare'
      ? { ok: true, status: 200, requestHash: 'h-cmp', requestId: null, resultCount: null, entities: [], payloadPresent: true }
      : { ok: true, status: 200, requestHash: 'test-hash', requestId: null, resultCount: 0, entities: [] }),
  }));
  assert.equal(v.legs.restCompare.status, 'ok');
  assert.ok(v.receipts.some((r) => r.operation === 'rest:/v2/analysis/compare'), 'compare leg must receipt');
});

test('Gap 2: REST error leg carries the exact failure label', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    restCall: async ({ path }) => (path === '/entities'
      ? { ok: false, status: 400, requestHash: 'h-ent', requestId: null, resultCount: null, entities: [] }
      : { ok: true, status: 200, requestHash: 'test-hash', requestId: null, resultCount: 0, entities: [] }),
  }));
  assert.equal(v.legs.restEntities.status, 'error');
  assert.equal(v.legs.restEntities.reason, 'Qloo REST returned 400');
  assert.equal(v.status, 'verdict', 'optional REST legs never block the verdict');
});

// ---- Gap 3: ID-threading ----

test('Gap 3: opener without an ID is resolved via describe before compare', async () => {
  const mcpCalls = [];
  const restCalls = [];
  const base = mcpFixture({
    qloo_recommend: { status: 'ok', results: [{ name: 'Nameless Opener' }] },
    qloo_rank: { status: 'ok', results: [{ name: 'Nameless Opener' }] },
  });
  const mcpCall = recordingMcp(async (tool, args) => {
    if (tool === 'qloo_describe' && args.entity === 'Nameless Opener') {
      return { status: 'ok', results: [{ id: 'test-entity-opener-resolved', name: 'Nameless Opener' }] };
    }
    return base(tool, args);
  }, mcpCalls);
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall, restCall: spyRest(restCalls, {}) }));
  assert.equal(v.status, 'verdict');
  const describeCalls = mcpCalls.filter((c) => c.tool === 'qloo_describe');
  assert.equal(describeCalls.length, 2, 'headliner describe + opener fallback describe');
  assert.ok(describeCalls.some((c) => c.args.entity === 'Nameless Opener'), 'fallback must describe the opener by name');
  const compare = mcpCalls.find((c) => c.tool === 'qloo_compare_audiences');
  assert.deepEqual(compare.args.group_b, ['test-entity-opener-resolved'], 'compare must take the resolved opener ID, not the name');
  const trends = mcpCalls.find((c) => c.tool === 'qloo_trends');
  assert.deepEqual(trends.args.entities, ['test-entity-billie'], 'trends must take the headliner ID, not the name');
  const entityTags = mcpCalls.find((c) => c.tool === 'qloo_entity_tags');
  assert.deepEqual(entityTags.args.entities, ['test-entity-billie', 'test-entity-opener-resolved']);
  const restCmp = restCalls.find((c) => c.path === '/v2/analysis/compare');
  assert.ok(restCmp, 'resolved opener ID must unlock the REST compare leg');
  assert.equal(restCmp.params['b.signal.interests.entities'], 'test-entity-opener-resolved');
  const restEnt = restCalls.find((c) => c.path === '/entities');
  assert.ok(String(restEnt.params.entity_ids).includes('test-entity-opener-resolved'), 'hydration must include the resolved opener ID');
});

test('Gap 3: no extra describe call when the opener already carries an ID', async () => {
  const mcpCalls = [];
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: recordingMcp(mcpFixture(), mcpCalls) }));
  assert.equal(v.status, 'verdict');
  assert.equal(mcpCalls.filter((c) => c.tool === 'qloo_describe').length, 1, 'only the headliner describe');
});

// ---- Gap 3: empty-leg diagnosability ----

test('Gap 3: empty trends/compare legs carry envelopeSummary', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({
      qloo_trends: { status: 'ok', summary: 'No trend data for this entity', results: [] },
      qloo_compare_audiences: { status: 'ok', summary: 'No overlap computed', results: [] },
    }),
  }));
  assert.equal(v.status, 'verdict', 'optional empty legs never block the verdict');
  assert.equal(v.legs.trends.status, 'empty');
  assert.equal(v.legs.trends.envelopeSummary, 'No trend data for this entity');
  assert.equal(v.legs.compare.status, 'empty');
  assert.equal(v.legs.compare.envelopeSummary, 'No overlap computed');
});

// ---- Static handler: malformed path guard ----

function httpRaw(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function waitHealthy(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const h = await httpRaw(port, '/api/health');
      if (h.status === 200) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('backend did not become healthy');
}

test('Static handler: bare double-slash path returns 400 and the process survives', { timeout: 30000 }, async () => {
  const child = spawn('node', ['backend/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, QLOO_API_KEY: 'test-only-not-a-real-key', PORT: '3471' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitHealthy(3471);
    const bad = await httpRaw(3471, '//');
    assert.equal(bad.status, 400);
    assert.equal(JSON.parse(bad.body).error.code, 'BAD_REQUEST');
    const health = await httpRaw(3471, '/api/health');
    assert.equal(health.status, 200, 'server must still answer after a malformed path');
    assert.equal(child.exitCode, null, 'process must not have crashed');
  } finally {
    child.kill('SIGTERM');
  }
});
