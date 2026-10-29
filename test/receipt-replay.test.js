// D8 — Receipt replay paths (MAX §2.3): every verdict receipt's replay
// payload must reproduce the exact original call (same MCP tool + args, same
// REST path + params); re-running the exact call against a local stub with
// unchanged data MATCHES (same entity IDs in the same order); changed data
// MISMATCHES (different IDs, or a different count) and the mismatch is
// detectable from the re-run alone. The count-comparison wording lives in
// the frontend drawer (not executable here); this file proves the backend
// data the comparison needs: replay fidelity + comparable re-run results.
// Replay without a key fails closed at the server (spawned, no key).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, mcpFixture, restFixture } from './fixtures.js';
import { qlooRest } from '../backend/src/rest.js';

test('D8: every verdict receipt replay payload reproduces its original call', async () => {
  const mcpCalls = [];
  const restCalls = [];
  const innerMcp = mcpFixture();
  const innerRest = restFixture();
  const deps = baseDeps({
    mcpCall: async (tool, args) => { mcpCalls.push([tool, args]); return innerMcp(tool, args); },
    restCall: async (arg) => { restCalls.push(arg); return innerRest(arg); },
  });
  const v = await runVerdict(baseInput(), deps);
  assert.equal(v.status, 'verdict');
  const replayable = v.receipts.filter((r) => r.replay);
  assert.ok(replayable.length >= 10, 'every leg must leave a replayable receipt');
  for (const r of replayable) {
    if (r.replay.kind === 'mcp') {
      const found = mcpCalls.find(([tool]) => tool === r.replay.tool);
      assert.ok(found, `no original MCP call recorded for ${r.replay.tool}`);
      assert.deepEqual(r.replay.args, found[1], `replay args must equal original args for ${r.replay.tool}`);
    } else if (r.replay.kind === 'rest') {
      const found = restCalls.find((c) => c.path === r.replay.path);
      assert.ok(found, `no original REST call recorded for ${r.replay.path}`);
      assert.deepEqual(r.replay.params, found.params, `replay params must equal original params for ${r.replay.path}`);
    } else {
      assert.fail(`unknown replay kind: ${r.replay.kind}`);
    }
  }
});

function stubServer(getBody) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getBody()));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

function entityIds(out) {
  return out.entities.map((e) => e.id);
}

test('D8: replay match — same stub data re-run returns same IDs in the same order', { timeout: 30000 }, async () => {
  const s = await stubServer(() => ({ entities: [
    { entity_id: 'a', name: 'Alpha' }, { entity_id: 'b', name: 'Beta' }, { entity_id: 'c', name: 'Gamma' },
  ] }));
  try {
    const args = { path: '/search', params: { query: 'jazz', take: 5 }, key: 'test-only-not-a-real-key', baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000 };
    const first = await qlooRest(args);
    const replay = await qlooRest(args);
    assert.deepEqual(entityIds(replay), entityIds(first));
    assert.equal(replay.resultCount, first.resultCount);
  } finally { s.close(); }
});

test('D8: replay mismatch — changed stub data returns different IDs (mismatch detectable)', { timeout: 30000 }, async () => {
  let mode = 'original';
  const s = await stubServer(() => (mode === 'original'
    ? { entities: [{ entity_id: 'a', name: 'Alpha' }, { entity_id: 'b', name: 'Beta' }] }
    : { entities: [{ entity_id: 'a', name: 'Alpha' }, { entity_id: 'z', name: 'Zeta' }] }));
  try {
    const args = { path: '/search', params: { query: 'jazz', take: 5 }, key: 'test-only-not-a-real-key', baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000 };
    const first = await qlooRest(args);
    mode = 'changed';
    const replay = await qlooRest(args);
    assert.notDeepEqual(entityIds(replay), entityIds(first));
  } finally { s.close(); }
});

test('D8: replay mismatch — changed stub count differs even when the first ID matches', { timeout: 30000 }, async () => {
  let mode = 'original';
  const s = await stubServer(() => (mode === 'original'
    ? { entities: [{ entity_id: 'a', name: 'Alpha' }, { entity_id: 'b', name: 'Beta' }] }
    : { entities: [{ entity_id: 'a', name: 'Alpha' }, { entity_id: 'b', name: 'Beta' }, { entity_id: 'c', name: 'Gamma' }] }));
  try {
    const args = { path: '/search', params: { query: 'jazz', take: 5 }, key: 'test-only-not-a-real-key', baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000 };
    const first = await qlooRest(args);
    mode = 'changed';
    const replay = await qlooRest(args);
    assert.notEqual(replay.resultCount, first.resultCount);
    assert.notDeepEqual(entityIds(replay), entityIds(first));
  } finally { s.close(); }
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

test('D8: replay without a key fails closed with 503 NOT_CONFIGURED (spawned server)', { timeout: 30000 }, async () => {
  const env = { ...process.env };
  delete env.QLOO_API_KEY;
  delete env.TICKETMASTER_API_KEY;
  env.PORT = '3458';
  const child = spawn('node', ['backend/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    let health = null;
    for (let i = 0; i < 50; i += 1) {
      try {
        health = await httpCall(3458, '/api/health');
        if (health.status === 200) break;
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(health.status, 200);
    const replay = await httpCall(3458, '/api/replay', 'POST', { kind: 'rest', path: '/search', params: { query: 'jazz', take: 5 } });
    assert.equal(replay.status, 503);
    assert.equal(JSON.parse(replay.body).error.code, 'NOT_CONFIGURED');
    // The key gate precedes body validation: even a bogus kind fails closed, never replays.
    const bogus = await httpCall(3458, '/api/replay', 'POST', { kind: 'bogus' });
    assert.equal(bogus.status, 503);
    assert.equal(JSON.parse(bogus.body).error.code, 'NOT_CONFIGURED');
  } finally {
    child.kill('SIGTERM');
  }
});
