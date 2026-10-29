// T10 (security + fail-closed): Retry-After in HTTP-date form.
// The seconds form and the 10s cap are already covered by
// test/retry-exact.test.js (local stub, never the live host); this file
// pins only the date form the old code dropped (Number(date) is NaN, so
// it retried immediately instead of honoring the date). Exactly one
// retry still holds: the stub counts requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { qlooRest } from '../backend/src/rest.js';

const TEST_KEY = 'test-only-not-a-real-key';

function stubServer(handler) {
  let count = 0;
  const at = [];
  const server = http.createServer((req, res) => {
    count += 1;
    at.push(Date.now());
    handler(req, res, count);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, count: () => count, at: () => at, close: () => server.close() });
    });
  });
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

test('T10 retry: 429 with an HTTP-date Retry-After waits until that date, then succeeds on exactly one retry', { timeout: 30000 }, async () => {
  // Asserted against the date itself, not an absolute elapsed floor:
  // under parallel load the 429 can arrive late, shrinking the remaining
  // wait — what must hold is that the retry lands at/after the date
  // (250ms tolerance for timer granularity), never immediately. Note the
  // date is second-resolution by spec: toUTCString() truncates the
  // millisecond component, so the comparison target is the truncated
  // date, not the millisecond-precise intent (up to 999ms earlier).
  const dateMs = Math.floor((Date.now() + 2000) / 1000) * 1000;
  const date = new Date(dateMs).toUTCString();
  const s = await stubServer((req, res, count) => {
    if (count === 1) json(res, 429, {}, { 'Retry-After': date });
    else json(res, 200, { entities: [{ entity_id: 'e1', name: 'Jazz' }] });
  });
  try {
    const t0 = Date.now();
    const out = await qlooRest({
      path: '/search', params: { query: 'jazz', take: 5 }, key: TEST_KEY,
      baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000,
    });
    const elapsed = Date.now() - t0;
    const [firstAt, secondAt] = s.at();
    assert.equal(out.ok, true);
    assert.equal(s.count(), 2, 'exactly one retry');
    assert.ok(firstAt < dateMs, 'the 429 must arrive before the Retry-After date for this test to be meaningful');
    assert.ok(secondAt >= dateMs - 250, `retry must wait until the Retry-After date (retried at ${secondAt}, date ${dateMs})`);
    assert.ok(elapsed < 15000, `wait must stay bounded, took ${elapsed}ms`);
  } finally { s.close(); }
});

test('T10 retry: 429 with a past HTTP-date Retry-After retries immediately (never a negative sleep)', { timeout: 30000 }, async () => {
  const date = new Date(Date.now() - 60000).toUTCString();
  const s = await stubServer((req, res, count) => {
    if (count === 1) json(res, 429, {}, { 'Retry-After': date });
    else json(res, 200, { entities: [{ entity_id: 'e1', name: 'Jazz' }] });
  });
  try {
    const t0 = Date.now();
    const out = await qlooRest({
      path: '/search', params: { query: 'jazz', take: 5 }, key: TEST_KEY,
      baseUrl: `http://127.0.0.1:${s.port}`, timeoutMs: 5000,
    });
    const elapsed = Date.now() - t0;
    assert.equal(out.ok, true);
    assert.equal(s.count(), 2);
    assert.ok(elapsed < 5000, `past-date Retry-After must retry at once, took ${elapsed}ms`);
  } finally { s.close(); }
});
