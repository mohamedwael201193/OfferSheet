// D3 — Exact retry counts for the Qloo REST client, against a LOCAL stub only
// (never fault-injected against the live host). Spec: exactly ONE retry on
// 429/5xx honoring Retry-After where present; NO retry otherwise (4xx, success,
// non-fetch errors). Every count below is measured from the stub, not asserted.
// Timeout retry is covered by T14; this file covers the status-code matrix,
// Retry-After honoring + its 10s cap, header-only auth, and requestId capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { qlooRest } from '../backend/src/rest.js';
import { requestHashFor } from '../backend/src/receipts.js';

const TEST_KEY = 'test-only-not-a-real-key';

function stubServer(handler) {
  let count = 0;
  const seen = [];
  const server = http.createServer((req, res) => {
    count += 1;
    seen.push({ url: req.url, headers: req.headers, at: Date.now() });
    handler(req, res, count);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        count: () => count,
        seen: () => seen,
        close: () => server.close(),
      });
    });
  });
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

async function call(port, extra = {}) {
  return qlooRest({
    path: '/search', params: { query: 'jazz', take: 5 }, key: TEST_KEY,
    baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 5000, ...extra,
  });
}

test('D3: 200 success makes exactly 1 request (no retry)', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => json(res, 200, { entities: [{ entity_id: 'e1', name: 'Jazz' }] }));
  try {
    const out = await call(s.port);
    assert.equal(out.ok, true);
    assert.equal(s.count(), 1);
  } finally { s.close(); }
});

test('D3: 400 makes exactly 1 request (no retry on client errors)', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => json(res, 400, {}));
  try {
    const out = await call(s.port);
    assert.equal(out.ok, false);
    assert.equal(out.status, 400);
    assert.equal(s.count(), 1);
  } finally { s.close(); }
});

test('D3: 401 makes exactly 1 request (no retry on auth errors)', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => json(res, 401, {}));
  try {
    const out = await call(s.port);
    assert.equal(out.ok, false);
    assert.equal(out.status, 401);
    assert.equal(s.count(), 1);
  } finally { s.close(); }
});

test('D3: 404 makes exactly 1 request (no retry)', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => json(res, 404, {}));
  try {
    const out = await call(s.port);
    assert.equal(out.ok, false);
    assert.equal(out.status, 404);
    assert.equal(s.count(), 1);
  } finally { s.close(); }
});

test('D3: 429 then 429 makes exactly 2 requests (one retry, then surfaces)', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => json(res, 429, {}, { 'Retry-After': '0' }));
  try {
    const out = await call(s.port);
    assert.equal(out.ok, false);
    assert.equal(out.status, 429);
    assert.equal(s.count(), 2);
  } finally { s.close(); }
});

test('D3: 503 then 200 succeeds after exactly 2 requests', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res, n) => {
    if (n === 1) json(res, 503, {});
    else json(res, 200, { entities: [{ entity_id: 'e1', name: 'Jazz' }] });
  });
  try {
    const out = await call(s.port);
    assert.equal(out.ok, true);
    assert.equal(s.count(), 2);
  } finally { s.close(); }
});

test('D3: 502 then 200 succeeds after exactly 2 requests', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res, n) => {
    if (n === 1) json(res, 502, {});
    else json(res, 200, { entities: [{ entity_id: 'e1', name: 'Jazz' }] });
  });
  try {
    const out = await call(s.port);
    assert.equal(out.ok, true);
    assert.equal(s.count(), 2);
  } finally { s.close(); }
});

test('D3: Retry-After 1s is honored before the retry', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res, n) => {
    if (n === 1) json(res, 429, {}, { 'Retry-After': '1' });
    else json(res, 200, { entities: [{ entity_id: 'e1', name: 'Jazz' }] });
  });
  try {
    const out = await call(s.port);
    assert.equal(out.ok, true);
    assert.equal(s.count(), 2);
    const gap = s.seen()[1].at - s.seen()[0].at;
    assert.ok(gap >= 900, `expected >=900ms backoff, got ${gap}ms`);
    assert.ok(gap < 5000, `backoff must not overshoot, got ${gap}ms`);
  } finally { s.close(); }
});

test('D3: Retry-After 30s is capped at 10s', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res, n) => {
    if (n === 1) json(res, 429, {}, { 'Retry-After': '30' });
    else json(res, 200, { entities: [{ entity_id: 'e1', name: 'Jazz' }] });
  });
  try {
    const t0 = Date.now();
    const out = await call(s.port);
    const elapsed = Date.now() - t0;
    assert.equal(out.ok, true);
    assert.equal(s.count(), 2);
    assert.ok(elapsed >= 9500, `expected >=9500ms capped backoff, got ${elapsed}ms`);
    assert.ok(elapsed < 15000, `cap must hold below 15s, got ${elapsed}ms`);
  } finally { s.close(); }
});

test('D3: 429 without Retry-After retries immediately (no invented delay)', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res, n) => {
    if (n === 1) json(res, 429, {});
    else json(res, 200, { entities: [{ entity_id: 'e1', name: 'Jazz' }] });
  });
  try {
    const t0 = Date.now();
    const out = await call(s.port);
    assert.equal(out.ok, true);
    assert.equal(s.count(), 2);
    assert.ok(Date.now() - t0 < 5000, 'no-Retry-After retry must be fast');
  } finally { s.close(); }
});

test('D3: fetch failure retries once (exactly 2 invocations), then throws', async () => {
  let invocations = 0;
  const fetchImpl = async () => {
    invocations += 1;
    throw new Error('fetch failed: connection reset');
  };
  await assert.rejects(
    () => qlooRest({ path: '/search', params: { query: 'jazz' }, key: TEST_KEY, baseUrl: 'http://127.0.0.1:1', fetchImpl }),
    /Qloo REST call failed/,
  );
  assert.equal(invocations, 2);
});

test('D3: non-fetch error is NOT retried (exactly 1 invocation)', async () => {
  let invocations = 0;
  const fetchImpl = async () => {
    invocations += 1;
    throw new Error('boom: unexpected local failure');
  };
  await assert.rejects(
    () => qlooRest({ path: '/search', params: { query: 'jazz' }, key: TEST_KEY, baseUrl: 'http://127.0.0.1:1', fetchImpl }),
    /Qloo REST call failed: boom/,
  );
  assert.equal(invocations, 1);
});

test('D3: key travels in the X-Api-Key header only, never in the hashed URL', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => json(res, 200, { entities: [] }));
  try {
    await call(s.port);
    const seen = s.seen()[0];
    assert.equal(seen.headers['x-api-key'], TEST_KEY);
    assert.ok(!seen.url.includes(TEST_KEY), 'key must never appear in the URL');
    assert.ok(!seen.url.includes('api-key') && !seen.url.includes('apikey'), 'no key param in URL');
  } finally { s.close(); }
});

test('D3: requestHash equals SHA-256 of the exact stub URL seen', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => json(res, 200, { entities: [] }));
  try {
    const out = await call(s.port);
    const seenUrl = `http://127.0.0.1:${s.port}${s.seen()[0].url}`;
    assert.equal(out.requestHash, requestHashFor('GET', seenUrl));
  } finally { s.close(); }
});

test('D3: changing a param changes the requestHash on the wire', { timeout: 30000 }, async () => {
  const s = await stubServer((req, res) => json(res, 200, { entities: [] }));
  try {
    const a = await qlooRest({ path: '/search', params: { query: 'jazz', take: 5 }, key: TEST_KEY, baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000 });
    const b = await qlooRest({ path: '/search', params: { query: 'jazz', take: 6 }, key: TEST_KEY, baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000 });
    assert.notEqual(a.requestHash, b.requestHash);
  } finally { s.close(); }
});

test('D3: requestId captured from body, snake_case body, and x-request-id header', { timeout: 30000 }, async () => {
  const cases = [
    [{ requestId: 'req-body', entities: [] }, {}, 'req-body'],
    [{ request_id: 'req-snake', entities: [] }, {}, 'req-snake'],
    [{ entities: [] }, { 'x-request-id': 'req-header' }, 'req-header'],
    [{ entities: [] }, {}, null],
  ];
  for (const [body, headers, expected] of cases) {
    const s = await stubServer((req, res) => json(res, 200, body, headers));
    try {
      const out = await call(s.port);
      assert.equal(out.requestId, expected);
    } finally { s.close(); }
  }
});
