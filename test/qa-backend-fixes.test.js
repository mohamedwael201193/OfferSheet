// QA backend fix pass (adversarial-reviewer findings G5/G6/G7/G8/G10/G13/G16/
// G17/G18/G24/G43/G47). Each test names the finding it proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, mcpFixture, restFixture } from './fixtures.js';
import { Guards } from '../backend/src/guards.js';
import { MCP_TOOLS } from '../backend/src/mcp.js';
import { qlooRest, REST_PATHS } from '../backend/src/rest.js';

const UNKNOWN_WORDING = 'Venue capacity unknown — Ticketmaster returned no capacity for this room. Break-even is shown as tickets needed, not as a sellout percentage. Verify room size before signing.';
const TM_DOWN_WORDING = 'Ticketmaster unavailable — capacity and event history not loaded';

// ---- G5: empty/partial evidence never counts as success ----
test('G5: where_popular ok-but-empty withholds the verdict', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({ qloo_where_popular: { status: 'ok', results: [] } }),
  }));
  assert.equal(v.status, 'verdict_withheld');
  assert.equal(v.legs.wherePopular.status, 'empty');
  assert.ok(v.missingLegs.includes('where_popular'));
  assert.ok(!('breakEven' in v));
});

test('G5: partial demographics withholds, and the leg keeps its partial status', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({ qloo_audience_demographics: { status: 'partial', summary: 'half the bands', results: [{ band: '18-24' }] } }),
  }));
  assert.equal(v.status, 'verdict_withheld');
  assert.equal(v.legs.demographics.status, 'partial');
  assert.ok(v.missingLegs.includes('demographics'));
});

test('G5: degraded compare alone does NOT withhold when entity_tags survives', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({ qloo_compare_audiences: { status: 'degraded', summary: 'partial overlap', results: [{ overlap: 'x' }] } }),
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.legs.compare.status, 'degraded');
});

test('G5: partial trends (optional) never blocks, but is never recorded ok', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({ qloo_trends: { status: 'partial', summary: 'gap in series', results: [{ date: '2026-10-01' }] } }),
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.legs.trends.status, 'partial');
});

// ---- G16: REST 2xx with empty entities -> 'empty', never 'ok' ----
test('G16: REST search 2xx with empty entities records empty with the no-data label', async () => {
  const inner = restFixture();
  const v = await runVerdict(baseInput(), baseDeps({
    restCall: async (arg) => (arg.path === '/search'
      ? { ok: true, status: 200, requestHash: 'h', requestId: null, resultCount: null, entities: [] }
      : inner(arg)),
  }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.legs.restSearch.status, 'empty');
  assert.match(v.legs.restSearch.reason, /no data for this entity\/region/);
});

// ---- G13: dead REST legs wired ----
function richRest() {
  const inner = restFixture();
  return async (arg) => {
    if (arg.path === '/v2/analysis/compare') {
      return { ok: true, status: 200, requestHash: 'h-cmp', requestId: 'req-cmp', resultCount: 2, entities: [{ id: 'test-entity-billie', name: 'Billie Eilish' }] };
    }
    if (arg.path === '/entities') {
      return { ok: true, status: 200, requestHash: 'h-ent', requestId: 'req-ent', resultCount: 2, entities: [{ id: 'test-entity-billie', name: 'Billie Eilish' }, { id: 'test-entity-opener-1', name: 'Test Opener One' }] };
    }
    return inner(arg);
  };
}

test('G13: restCompare + restEntities run in the verdict with receipts', async () => {
  const seen = [];
  const v = await runVerdict(baseInput(), baseDeps({
    restCall: async (arg) => { seen.push(arg.path); return richRest()(arg); },
  }));
  assert.equal(v.status, 'verdict');
  assert.ok(seen.includes('/v2/analysis/compare'), 'compare leg must be called');
  assert.ok(seen.includes('/entities'), 'entities leg must be called');
  assert.equal(v.legs.restCompare.status, 'ok');
  assert.equal(v.legs.restEntities.status, 'ok');
  assert.deepEqual(v.legs.restEntities.entities.map((e) => e.id), ['test-entity-billie', 'test-entity-opener-1']);
  const ops = v.receipts.map((r) => r.operation);
  assert.ok(ops.includes('rest:/v2/analysis/compare'));
  assert.ok(ops.includes('rest:/entities'));
});

test('G13: restCompare skips honestly when no entity IDs exist to compare', async () => {
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: mcpFixture({
      qloo_describe: { status: 'ok', results: [{ name: 'Billie Eilish' }] },
      qloo_recommend: { status: 'ok', results: [{ name: 'Test Opener One' }] },
      qloo_rank: { status: 'ok', results: [{ name: 'Test Opener One' }] },
    }),
    restCall: richRest(),
  }));
  assert.equal(v.legs.restCompare.status, 'skipped');
  assert.equal(v.legs.restEntities.status, 'skipped');
});

// ---- G17: MCP vs REST receipt hashes distinguishable ----
test('G17: MCP receipts carry hashKind args, REST receipts hashKind url, MCP requestId stays null', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ restCall: richRest() }));
  assert.equal(v.status, 'verdict');
  const mcpRecs = v.receipts.filter((r) => r.operation.startsWith('qloo_'));
  const restRecs = v.receipts.filter((r) => r.operation.startsWith('rest:'));
  assert.ok(mcpRecs.length > 0 && restRecs.length > 0);
  for (const r of mcpRecs) {
    assert.equal(r.hashKind, 'args', `${r.operation} must be an argument hash`);
    assert.equal(r.requestId, null, 'MCP requestId must never be invented');
  }
  for (const r of restRecs) assert.equal(r.hashKind, 'url', `${r.operation} must be a URL hash`);
});

// ---- G24: per-cause capacity wording ----
test('G24: key-not-configured capacity says the leg is not configured', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ config: { qlooKeyConfigured: true, tmKeyConfigured: false } }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.capacity.state, 'unknown');
  assert.equal(v.capacity.cause, 'not_configured');
  assert.match(v.capacity.message, /not configured/);
  assert.notEqual(v.capacity.message, UNKNOWN_WORDING);
});

test('G24: Ticketmaster error uses the MAX unavailable wording verbatim', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ tmEvents: async () => { throw new Error('down'); } }));
  assert.equal(v.status, 'verdict');
  assert.equal(v.capacity.cause, 'error');
  assert.equal(v.capacity.message, TM_DOWN_WORDING);
});

test('G24: only a fetched venue without the field uses the no-capacity wording', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  assert.equal(v.capacity.cause, 'no_field');
  assert.equal(v.capacity.message, UNKNOWN_WORDING);
});

// ---- G43: price_unknown still returns labeled partial evidence ----
test('G43: price_unknown carries partial audience + openers + legs, never a break-even number', async () => {
  const { ticketPrice, ...noPrice } = baseInput();
  const v = await runVerdict(noPrice, baseDeps({
    tmEvents: async () => ({ ok: true, status: 200, body: { _embedded: { events: [{ _embedded: { venues: [{ name: 'Test Room' }] } }] } } }),
  }));
  assert.equal(v.status, 'price_unknown');
  assert.ok(!('breakEven' in v), 'no break-even number may render without a price');
  assert.ok(v.partial, 'partial evidence object must exist');
  assert.match(v.partial.label, /not a verdict/i);
  assert.equal(v.partial.audience.areas.length, 2);
  assert.match(v.partial.audience.note, /not a headcount/);
  assert.equal(v.partial.openers.topPick, 'Test Opener One');
  assert.ok(v.partial.legs, 'partial evidence must include the legs');
});

// ---- G8/G47: budget + abort end withheld, never partial ----
test('G47: an exceeded overall budget ends withheld with a disclosed timeout', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ verdictBudgetMs: 0 }));
  assert.equal(v.status, 'verdict_withheld');
  assert.equal(v.timeout, true);
  assert.match(v.message, /time budget/);
  assert.ok(!('breakEven' in v));
});

test('G47: a closed client request ends withheld with a disclosed cancel', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ isCancelled: () => true }));
  assert.equal(v.status, 'verdict_withheld');
  assert.equal(v.cancelled, true);
  assert.ok(!('breakEven' in v));
});

test('G8: evidence legs fan out (both start before either resolves), chain stays sequential', async () => {
  const started = [];
  const resolvers = {};
  const inner = mcpFixture();
  const gate = new Promise((resolve) => {
    const check = () => { if (started.includes('qloo_where_popular') && started.includes('qloo_audience_demographics')) resolve(); };
    resolvers.check = check;
  });
  let recommendResolved = false;
  const v = await runVerdict(baseInput(), baseDeps({
    mcpCall: async (tool, args) => {
      if (tool === 'qloo_where_popular' || tool === 'qloo_audience_demographics') {
        started.push(tool);
        resolvers.check();
        await gate;
        return inner(tool, args);
      }
      if (tool === 'qloo_recommend') {
        const out = await inner(tool, args);
        recommendResolved = true;
        return out;
      }
      if (tool === 'qloo_rank') {
        assert.ok(recommendResolved, 'rank must not start before recommend resolves');
        return inner(tool, args);
      }
      return inner(tool, args);
    },
  }));
  assert.equal(v.status, 'verdict');
  assert.ok(started.includes('qloo_where_popular') && started.includes('qloo_audience_demographics'));
});

// ---- G6/G10: allowlists + relative-path guard (unit level) ----
test('G6: allowlists are exactly the 10 official tools and the 4 REST paths', () => {
  assert.deepEqual(MCP_TOOLS, ['qloo_capabilities', 'qloo_find_tags', 'qloo_describe', 'qloo_recommend', 'qloo_rank', 'qloo_where_popular', 'qloo_compare_audiences', 'qloo_audience_demographics', 'qloo_entity_tags', 'qloo_trends']);
  assert.deepEqual(REST_PATHS, ['/search', '/v2/insights', '/v2/analysis/compare', '/entities']);
});

test('G6: qlooRest rejects absolute URLs without calling fetch', async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; throw new Error('must not be called'); };
  await assert.rejects(
    qlooRest({ path: 'https://evil.example/search', params: {}, key: 'k', baseUrl: 'https://hackathon.api.qloo.com', fetchImpl }),
    /relative path/,
  );
  await assert.rejects(
    qlooRest({ path: '//evil.example/search', params: {}, key: 'k', baseUrl: 'https://hackathon.api.qloo.com', fetchImpl }),
    /relative path/,
  );
  assert.equal(called, 0);
});

// ---- G10: visitor map pruned by day ----
test('G10: visitor entries from a previous day are pruned on the next check', () => {
  const g = new Guards();
  g.visitorCounts.set('1.2.3.4:2000-01-01', 20);
  g.checkVisitor('5.6.7.8');
  assert.ok(!g.visitorCounts.has('1.2.3.4:2000-01-01'), 'stale day entry must be pruned');
  assert.equal(g.visitorCounts.size, 1);
});

// ---- Server level: G6 replay validation + guards, G7 comparison data, G10/G18 health ----
function httpCall(port, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function stubServer(getBody) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getBody()));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

function spawnBackend(port, extraEnv) {
  const env = {
    ...process.env,
    QLOO_API_KEY: 'test-only-not-a-real-key',
    PORT: String(port),
    ...extraEnv,
  };
  delete env.TICKETMASTER_API_KEY;
  const child = spawn('node', ['backend/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function waitHealthy(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const h = await httpCall(port, '/api/health');
      if (h.status === 200) return JSON.parse(h.body);
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('backend did not become healthy');
}

test('G6+G7: replay rejects absolute URLs and non-allowlisted paths/tools, returns ordered IDs', { timeout: 30000 }, async () => {
  const stub = await stubServer(() => ({ entities: [
    { entity_id: 'a', name: 'Alpha' }, { entity_id: 'b', name: 'Beta' }, { entity_id: 'c', name: 'Gamma' },
  ] }));
  const child = spawnBackend(3461, { QLOO_BASE_URL: `http://127.0.0.1:${stub.port}` });
  try {
    await waitHealthy(3461);
    const abs = await httpCall(3461, '/api/replay', 'POST', { kind: 'rest', path: 'https://evil.example/search', params: {} });
    assert.equal(abs.status, 400);
    const badPath = await httpCall(3461, '/api/replay', 'POST', { kind: 'rest', path: '/v2/tags', params: {} });
    assert.equal(badPath.status, 400);
    const badTool = await httpCall(3461, '/api/replay', 'POST', { kind: 'mcp', tool: 'qloo_taste_profile', args: {} });
    assert.equal(badTool.status, 400);
    const ok = await httpCall(3461, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz', take: 5 } });
    assert.equal(ok.status, 200);
    const body = JSON.parse(ok.body);
    assert.equal(body.kind, 'rest');
    assert.equal(body.path, '/search');
    assert.deepEqual(body.entityIds, ['a', 'b', 'c'], 'replay must return ORDERED entity IDs');
    assert.deepEqual(body.ids, ['a', 'b', 'c'], 'replay must also expose the ids alias the comparator reads first');
    assert.equal(body.resultCount, 3);
  } finally {
    child.kill('SIGTERM');
    stub.close();
  }
});

test('G6: replay counts against the monthly guard (second replay trips QUOTA_FLOOR)', { timeout: 30000 }, async () => {
  const stub = await stubServer(() => ({ entities: [{ entity_id: 'a', name: 'Alpha' }] }));
  const child = spawnBackend(3462, { QLOO_BASE_URL: `http://127.0.0.1:${stub.port}`, MONTHLY_CALL_BUDGET: '1' });
  try {
    await waitHealthy(3462);
    const first = await httpCall(3462, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz' } });
    assert.equal(first.status, 200);
    const second = await httpCall(3462, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz' } });
    assert.equal(second.status, 503);
    assert.equal(JSON.parse(second.body).error.code, 'QUOTA_FLOOR');
  } finally {
    child.kill('SIGTERM');
    stub.close();
  }
});

test('G6: replay counts against the per-visitor guard (second replay trips VISITOR_CAP)', { timeout: 30000 }, async () => {
  const stub = await stubServer(() => ({ entities: [{ entity_id: 'a', name: 'Alpha' }] }));
  const child = spawnBackend(3463, { QLOO_BASE_URL: `http://127.0.0.1:${stub.port}`, PER_VISITOR_DAILY_CAP: '1' });
  try {
    await waitHealthy(3463);
    const first = await httpCall(3463, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz' } });
    assert.equal(first.status, 200);
    const second = await httpCall(3463, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz' } });
    assert.equal(second.status, 429);
    assert.equal(JSON.parse(second.body).error.code, 'VISITOR_CAP');
  } finally {
    child.kill('SIGTERM');
    stub.close();
  }
});

test('G7-alignment: verdict receipts carry the original ordered ID list for entity legs, none for ID-less legs', async () => {
  const v = await runVerdict(baseInput(), baseDeps({ restCall: richRest() }));
  assert.equal(v.status, 'verdict');
  const byOp = (op) => v.receipts.find((r) => r.operation === op);
  assert.deepEqual(byOp('qloo_describe').entityIds, ['test-entity-billie']);
  assert.deepEqual(byOp('qloo_describe').ids, ['test-entity-billie']);
  assert.deepEqual(byOp('qloo_rank').entityIds, ['test-entity-opener-1', 'test-entity-opener-2']);
  assert.deepEqual(byOp('rest:/search').entityIds, ['test-entity-billie']);
  // Demographics bands carry no entity IDs: no ID field, so the comparator
  // honestly reports "not comparable" instead of matching on an empty list.
  const demo = byOp('qloo_audience_demographics');
  assert.ok(!('ids' in demo) && !('entityIds' in demo), 'ID-less legs must not carry an empty ID list');
});

test('G10+G18: health exposes qlooConfigured only — no tool count, no guard counts', { timeout: 30000 }, async () => {
  const child = spawnBackend(3464, {});
  try {
    const h = await waitHealthy(3464);
    assert.equal(h.qlooConfigured, true);
    assert.ok(!('tools' in h), 'health must not hardcode a tools count');
    assert.ok(!('guards' in h), 'health must not expose guard counts');
    assert.ok(!('qlooKey' in h) && !('ticketmasterKey' in h), 'health must not expose key fields');
  } finally {
    child.kill('SIGTERM');
  }
});
