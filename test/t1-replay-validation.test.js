// T1 (provenance) — replay validation + replay response fidelity.
// Backend-only. No live Qloo: MCP validation is a pure unit check, and the
// REST replay path runs against a local stub through a spawned backend
// (QLOO_BASE_URL override + a test-only key). The stub and the backend
// each bind an ephemeral port so parallel test files cannot collide.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnEphemeralBackend } from './ephemeral-backend.js';
import { validateMcpReplayArgs } from '../backend/src/mcp.js';

// Every argument shape the verdict pipeline, the re-rank path, and the
// routing step actually send — these must all validate.
const PIPELINE_SHAPES = [
  ['qloo_capabilities', {}],
  ['qloo_find_tags', { query: 'Billie Eilish', limit: 10 }],
  ['qloo_describe', { entity: 'Billie Eilish', type: 'artist' }],
  ['qloo_recommend', { target_type: 'artist', signals: ['entity-1'], limit: 10 }],
  ['qloo_rank', { options: ['a', 'b'], option_type: 'artist', signals: ['entity-1'], signal_location: 'New York' }],
  ['qloo_where_popular', { entity: 'entity-1', within: 'New York', limit: 10 }],
  ['qloo_compare_audiences', { group_a: ['entity-1'], group_b: ['entity-2'], target_type: 'artist' }],
  ['qloo_audience_demographics', { entity: 'entity-1', entity_type: 'artist' }],
  ['qloo_entity_tags', { entities: ['entity-1', 'entity-2'], entity_type: 'artist', limit: 10 }],
  ['qloo_trends', { entities: ['entity-1'], entity_type: 'artist', start_date: '2026-07-01', end_date: '2026-10-01' }],
];

test('T1: every pipeline/re-rank/routing MCP arg shape validates', () => {
  for (const [tool, args] of PIPELINE_SHAPES) {
    assert.doesNotThrow(() => validateMcpReplayArgs(tool, args), `${tool} must validate`);
  }
});

test('T1: an unknown MCP arg key is rejected (silently-ignored-key false match closed)', () => {
  for (const [tool, args] of PIPELINE_SHAPES) {
    assert.throws(
      () => validateMcpReplayArgs(tool, { ...args, bogus_key: 1 }),
      /not allowlisted/,
      `${tool} must reject an unknown key`,
    );
  }
});

test('T1: capabilities allowlist matches the proxy definition — operation_ids replayable', () => {
  // Receipt-gap closure (patch 09): the MCP server's qloo_capabilities
  // proxy tool declares operation_ids, so a proxy capabilities receipt
  // carrying it must replay under the allowlist; the verdict readiness
  // probe still sends {}.
  assert.doesNotThrow(() => validateMcpReplayArgs('qloo_capabilities', {}));
  assert.doesNotThrow(() => validateMcpReplayArgs('qloo_capabilities', { operation_ids: ['rank'] }));
});

test('T1: unknown tool and non-object args are rejected', () => {
  assert.throws(() => validateMcpReplayArgs('qloo_not_a_tool', {}), /not allowlisted/);
  assert.throws(() => validateMcpReplayArgs('qloo_rank', []), /must be an object/);
  assert.throws(() => validateMcpReplayArgs('qloo_rank', null), /must be an object/);
  assert.throws(() => validateMcpReplayArgs('qloo_rank', 'options'), /must be an object/);
});

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

function stubServer() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/search')) {
      res.end(JSON.stringify({ entities: [{ entity_id: 'stub-1', name: 'Stub One' }, { entity_id: 'stub-2', name: 'Stub Two' }] }));
    } else if (req.url.startsWith('/v2/insights')) {
      res.end(JSON.stringify({ entities: [{ entity_id: 'stub-9', name: 'Stub Nine' }] }));
    } else {
      res.end(JSON.stringify({ entities: [] }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, hits, close: () => server.close() }));
  });
}

function spawnBackend(stubPort) {
  const env = { ...process.env };
  env.QLOO_API_KEY = 'test-only-not-a-real-key';
  // No stub: keep REST pointed at a closed local port so a stray replay
  // cannot leave the machine. Callers that start a stub pass its port.
  env.QLOO_BASE_URL = stubPort ? `http://127.0.0.1:${stubPort}` : 'http://127.0.0.1:1';
  delete env.TICKETMASTER_API_KEY;
  return spawnEphemeralBackend(env);
}

async function waitHealthy(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const h = await httpCall(port, '/api/health');
      if (h.status === 200) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('spawned backend never became healthy');
}

test('T1: spawned REST replay — unallowlisted param and missing filter.type fail 400 before any Qloo call', { timeout: 30000 }, async () => {
  const stub = await stubServer();
  const { child, port } = await spawnBackend(stub.port);
  try {
    await waitHealthy(port);
    const badParam = await httpCall(port, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz', take: 5, bogus: 1 } });
    assert.equal(badParam.status, 400);
    assert.match(JSON.parse(badParam.body).error.message, /not allowlisted/);
    const noFilter = await httpCall(port, '/api/replay', 'POST', { kind: 'rest', path: '/v2/insights', params: { 'signal.interests.tags': 'urn:tag:x', 'feature.explainability': 'true' } });
    assert.equal(noFilter.status, 400);
    assert.match(JSON.parse(noFilter.body).error.message, /filter\.type/);
    assert.equal(stub.hits.length, 0, 'invalid replays must never reach the upstream');
  } finally {
    child.kill('SIGTERM');
    stub.close();
  }
});

test('T1: spawned REST replay — valid replay returns requestHash for call-fidelity comparison', { timeout: 30000 }, async () => {
  const stub = await stubServer();
  const { child, port } = await spawnBackend(stub.port);
  try {
    await waitHealthy(port);
    const ok = await httpCall(port, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz', take: 5 } });
    assert.equal(ok.status, 200);
    const out = JSON.parse(ok.body);
    assert.match(out.requestHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(out.ids, ['stub-1', 'stub-2']);
    assert.equal(out.resultCount, 2);
    assert.equal(stub.hits.length, 1);
  } finally {
    child.kill('SIGTERM');
    stub.close();
  }
});

test('T1: spawned MCP replay — unknown arg key fails 400 before any session is spawned', { timeout: 30000 }, async () => {
  const { child, port } = await spawnBackend();
  try {
    await waitHealthy(port);
    const bad = await httpCall(port, '/api/replay', 'POST', { kind: 'mcp', tool: 'qloo_rank', args: { options: ['a'], bogus: 1 } });
    assert.equal(bad.status, 400);
    assert.match(JSON.parse(bad.body).error.message, /not allowlisted/);
    // A valid shape passes validation: without a harness binary it fails
    // downstream (spawn), but it must NOT fail validation with 400.
    const valid = await httpCall(port, '/api/replay', 'POST', { kind: 'mcp', tool: 'qloo_rank', args: { options: ['a'], option_type: 'artist', signals: ['e'], signal_location: 'New York' } });
    assert.notEqual(valid.status, 400);
  } finally {
    child.kill('SIGTERM');
  }
});
