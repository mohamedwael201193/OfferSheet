import test from 'node:test';
import assert from 'node:assert/strict';
import { qlooRest, REST_MAX_CONCURRENCY } from '../backend/src/rest.js';

const base = 'https://hackathon.api.qloo.com';
const okBody = JSON.stringify({ results: { entities: [{ entity_id: 'a', name: 'A' }] } });

test('U18: identical in-flight REST calls share one upstream request', async () => {
  let n = 0;
  const f = async () => { n += 1; await new Promise((r) => setTimeout(r, 30)); return new Response(okBody, { status: 200 }); };
  const args = { path: '/search', params: { query: 'x', take: 5 }, key: 'k', baseUrl: base, fetchImpl: f };
  const [a, b] = await Promise.all([qlooRest(args), qlooRest(args)]);
  assert.equal(n, 1);
  assert.equal(a, b);
});

test('U18: REST concurrency is capped', async () => {
  let active = 0, peak = 0;
  const f = async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active -= 1; return new Response(okBody, { status: 200 }); };
  await Promise.all([1, 2, 3, 4, 5].map((i) => qlooRest({ path: '/search', params: { query: 'q' + i }, key: 'k', baseUrl: base, fetchImpl: f })));
  assert.ok(peak <= REST_MAX_CONCURRENCY, `peak ${peak}`);
});

test('U18: a 429 without Retry-After backs off before its single retry and is flagged', async () => {
  const times = [];
  const f = async () => { times.push(Date.now()); return times.length === 1 ? new Response('{}', { status: 429 }) : new Response(okBody, { status: 200 }); };
  const out = await qlooRest({ path: '/search', params: { query: 'z' }, key: 'k', baseUrl: base, fetchImpl: f });
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 1000, 'backoff >= 1s');
  assert.equal(out.ok, true);
  assert.equal(out.retried429, true);
});
