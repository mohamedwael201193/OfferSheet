// T04 (fail-closed mapping, unit) + T10 (no-key 503 staging run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import {
  notConfigured, qlooAuthFailed, quotaFloorTripped, visitorCapTripped,
  runCapTripped, invalidInput, mapEnvelopeError,
} from '../backend/src/errors.js';

test('T04: error taxonomy maps to the documented codes and statuses', () => {
  assert.equal(notConfigured().code, 'NOT_CONFIGURED');
  assert.equal(notConfigured().status, 503);
  assert.equal(qlooAuthFailed().code, 'QLOO_AUTH');
  assert.equal(qlooAuthFailed().status, 503);
  assert.equal(quotaFloorTripped().status, 503);
  assert.equal(visitorCapTripped().status, 429);
  assert.equal(runCapTripped().status, 503);
  assert.equal(invalidInput('x').status, 400);
});

test('T04: envelope errors map (auth -> 503, other -> 502, never a verdict)', () => {
  const auth = mapEnvelopeError({ error: { code: 'QLOO_AUTH' } });
  assert.equal(auth.code, 'QLOO_AUTH');
  assert.equal(auth.status, 503);
  const other = mapEnvelopeError({ error: { code: 'QLOO_ERROR' } });
  assert.equal(other.status, 502);
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

test('T10: server with no key serves a visible 503 on the verdict path (staging)', { timeout: 30000 }, async () => {
  const env = { ...process.env };
  delete env.QLOO_API_KEY;
  delete env.TICKETMASTER_API_KEY;
  env.PORT = '3457';
  const child = spawn('node', ['backend/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    // Wait for the health endpoint (up to 5s).
    let health = null;
    for (let i = 0; i < 50; i += 1) {
      try {
        health = await httpCall(3457, '/api/health');
        if (health.status === 200) break;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(health.status, 200);
    const h = JSON.parse(health.body);
    assert.equal(h.qlooConfigured, false);
    assert.ok(!('qlooKey' in h) && !('ticketmasterKey' in h), 'health must not expose key fields');

    const verdict = await httpCall(3457, '/api/verdict', 'POST', { artist: 'Billie Eilish', city: 'New York', guarantee: 250000 });
    assert.equal(verdict.status, 503);
    const v = JSON.parse(verdict.body);
    assert.equal(v.error.code, 'NOT_CONFIGURED');
    assert.match(v.error.message, /not configured/i);

    const page = await httpCall(3457, '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /OfferSheet/);
  } finally {
    child.kill('SIGTERM');
  }
});
