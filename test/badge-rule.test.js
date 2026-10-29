// D9 — Badge rule (MAX §2.1): the "Qloo live" badge turns green ONLY when a
// live call in the run succeeded; probe-alone never turns it green. The
// frontend implements the badge from two backend states: /api/health's
// qlooConfigured flag (amber at most) and a successful verdict object
// (green). This file tests the backend side of that contract: health never
// claims live/green, config-alone produces no verdict, and a capabilities
// probe succeeding while every data leg fails yields WITHHELD, never a
// verdict — so no green state can derive from a probe alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, mcpFixture } from './fixtures.js';

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

test('D9: health never claims live/green/badge state (config flag only)', { timeout: 30000 }, async () => {
  const env = { ...process.env };
  delete env.QLOO_API_KEY;
  delete env.TICKETMASTER_API_KEY;
  env.PORT = '3459';
  const child = spawn('node', ['backend/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    let health = null;
    for (let i = 0; i < 50; i += 1) {
      try {
        health = await httpCall(3459, '/api/health');
        if (health.status === 200) break;
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(health.status, 200);
    const h = JSON.parse(health.body);
    assert.equal(h.qlooConfigured, false);
    for (const k of Object.keys(h)) {
      assert.ok(!/live|green|badge/i.test(k), `health must not expose a live/green/badge field: ${k}`);
    }
    assert.ok(!('qlooKey' in h) && !('ticketmasterKey' in h), 'health must not expose key fields');
  } finally {
    child.kill('SIGTERM');
  }
});

test('D9: probe-alone never yields a verdict (capabilities ok, all data legs fail)', async () => {
  const probeOnly = async (tool) => {
    if (tool === 'qloo_capabilities') return { status: 'ok', operations: ['recommend'] };
    throw new Error(`test leg failure: ${tool}`);
  };
  const v = await runVerdict(baseInput(), baseDeps({ mcpCall: probeOnly }));
  assert.equal(v.status, 'verdict_withheld');
  assert.notEqual(v.status, 'verdict');
});

test('D9: no-key run makes zero live calls and throws before any verdict exists', async () => {
  let mcpCalls = 0;
  const deps = baseDeps({
    config: { qlooKeyConfigured: false, tmKeyConfigured: false },
    mcpCall: async (tool, args) => { mcpCalls += 1; return mcpFixture()(tool, args); },
  });
  await assert.rejects(
    () => runVerdict(baseInput(), deps),
    (e) => e.code === 'NOT_CONFIGURED' && e.status === 503,
  );
  assert.equal(mcpCalls, 0, 'no live call may happen without a key, so no green state can derive');
});

test('D9: a failed readiness probe yields no verdict object at all', async () => {
  const deps = baseDeps({
    mcpCall: mcpFixture({ qloo_capabilities: new Error('test transport failure') }),
  });
  await assert.rejects(() => runVerdict(baseInput(), deps), /test transport failure/);
});
