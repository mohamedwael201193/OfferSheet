// G3 (superiority): per-path REST param allowlist + mandatory filter.type,
// enforced in qlooRest so verdict legs AND replay pass the same gate.
// A typo'd param fails closed before any call; an unallowlisted replay
// param is rejected with a 400, never sent to Qloo under a receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { qlooRest, REST_PARAM_ALLOWLIST } from '../backend/src/rest.js';

function fetchSpy() {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ entities: [] }) };
  };
  fn.calls = () => calls;
  return fn;
}

test('G3: typo\'d param on /search fails closed before any fetch', async () => {
  const fetchImpl = fetchSpy();
  await assert.rejects(
    () => qlooRest({ path: '/search', params: { query: 'jazz', tak: 5 }, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com', fetchImpl }),
    (e) => {
      assert.equal(e.code, 'INVALID_INPUT');
      assert.equal(e.status, 400);
      assert.match(e.message, /not allowlisted/);
      return true;
    },
  );
  assert.equal(fetchImpl.calls(), 0, 'no fetch may happen for a rejected param');
});

test('G3: /v2/insights without filter.type fails closed; with it, it passes', async () => {
  const fetchImpl = fetchSpy();
  await assert.rejects(
    () => qlooRest({ path: '/v2/insights', params: { 'signal.interests.tags': 'urn:tag:x' }, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com', fetchImpl }),
    (e) => {
      assert.equal(e.code, 'INVALID_INPUT');
      assert.match(e.message, /filter\.type/);
      return true;
    },
  );
  await assert.rejects(
    () => qlooRest({ path: '/v2/insights', params: { 'filter.type': '', 'signal.interests.tags': 'urn:tag:x' }, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com', fetchImpl }),
    (e) => {
      assert.equal(e.code, 'INVALID_INPUT');
      return true;
    },
  );
  assert.equal(fetchImpl.calls(), 0);
  const ok = await qlooRest({ path: '/v2/insights', params: { 'filter.type': 'urn:entity:artist', 'signal.interests.tags': 'urn:tag:x', 'feature.explainability': 'true' }, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com', fetchImpl });
  assert.equal(ok.ok, true);
  assert.equal(fetchImpl.calls(), 1);
});

test('G3: non-allowlisted path is rejected by qlooRest itself (defense in depth)', async () => {
  const fetchImpl = fetchSpy();
  await assert.rejects(
    () => qlooRest({ path: '/v2/tags', params: {}, key: 'test-only-not-a-real-key', baseUrl: 'https://hackathon.api.qloo.com', fetchImpl }),
    (e) => {
      assert.equal(e.code, 'INVALID_INPUT');
      return true;
    },
  );
  assert.equal(fetchImpl.calls(), 0);
});

test('G3: allowlist covers exactly the four wrapper param sets', () => {
  assert.deepEqual(Object.keys(REST_PARAM_ALLOWLIST).sort(), ['/entities', '/search', '/v2/analysis/compare', '/v2/insights']);
  assert.deepEqual(REST_PARAM_ALLOWLIST['/search'], ['query', 'take']);
  assert.deepEqual(REST_PARAM_ALLOWLIST['/v2/insights'], ['filter.type', 'signal.interests.tags', 'feature.explainability']);
  assert.deepEqual(REST_PARAM_ALLOWLIST['/v2/analysis/compare'], ['a.signal.interests.entities', 'b.signal.interests.entities']);
  assert.deepEqual(REST_PARAM_ALLOWLIST['/entities'], ['entity_ids']);
});

// ---- Server level: replay with an unallowlisted param is a 400 ----
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

async function waitHealthy(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const h = await httpCall(port, '/api/health');
      if (h.status === 200) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('backend did not become healthy');
}

test('G3: replay with an unallowlisted param returns 400, valid replay still 200', { timeout: 30000 }, async () => {
  const stub = await stubServer(() => ({ entities: [{ entity_id: 'a', name: 'Alpha' }] }));
  const child = spawn('node', ['backend/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, QLOO_API_KEY: 'test-only-not-a-real-key', PORT: '3463', QLOO_BASE_URL: `http://127.0.0.1:${stub.port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitHealthy(3463);
    const bad = await httpCall(3463, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz', tak: 5 } });
    assert.equal(bad.status, 400);
    assert.match(JSON.parse(bad.body).error.message, /not allowlisted/);
    const badInsights = await httpCall(3463, '/api/replay', 'POST', { kind: 'rest', path: '/v2/insights', params: { 'signal.interests.tags': 'urn:tag:x' } });
    assert.equal(badInsights.status, 400);
    const ok = await httpCall(3463, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz', take: 5 } });
    assert.equal(ok.status, 200);
  } finally {
    child.kill();
    stub.close();
  }
});
