// T14 — retry/backoff against a LOCAL stub only (never fault-injected against
// the live host). Spec: 25s timeout, exactly one retry on 429/5xx honoring
// Retry-After where present. The stub counts requests so the retry count is
// measured, not asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { qlooRest } from '../backend/src/rest.js';

function stubServer(handler) {
  let count = 0;
  const server = http.createServer((req, res) => {
    count += 1;
    handler(req, res, count);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, count: () => count, close: () => server.close() });
    });
  });
}

test('T14: 429 with Retry-After then 200 succeeds after exactly 2 requests', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res, n) => {
    if (n === 1) {
      res.writeHead(429, { 'Retry-After': '0', 'Content-Type': 'application/json' });
      res.end('{}');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entities: [{ entity_id: 'x', name: 'Jazz' }] }));
    }
  });
  try {
    const out = await qlooRest({ path: '/search', params: { query: 'jazz', take: 5 }, key: 'test-only-not-a-real-key', baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000 });
    assert.equal(out.ok, true);
    assert.equal(out.status, 200);
    assert.equal(s.count(), 2);
  } finally {
    s.close();
  }
});

test('T14: always-500 surfaces as a failed leg after exactly 2 requests (one retry)', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    const out = await qlooRest({ path: '/search', params: { query: 'jazz', take: 5 }, key: 'test-only-not-a-real-key', baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000 });
    assert.equal(out.ok, false);
    assert.equal(out.status, 500);
    assert.equal(s.count(), 2);
  } finally {
    s.close();
  }
});

test('T14: timeout aborts and retries once, then throws (2 requests total)', { timeout: 30000 }, async () => {
  const s = await stubServer(() => {
    // Never respond: the client timeout must fire.
  });
  try {
    await assert.rejects(
      () => qlooRest({ path: '/search', params: { query: 'jazz', take: 5 }, key: 'test-only-not-a-real-key', baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 200 }),
      /Qloo REST call failed/,
    );
    assert.equal(s.count(), 2);
  } finally {
    s.close();
  }
});
