// T02 — receipt-hash determinism (unit, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, requestHashFor, argsHashFor, ReceiptStore } from '../backend/src/receipts.js';

test('T02: sha256 is deterministic and input-sensitive', () => {
  assert.equal(sha256('GET https://example.test/search?q=jazz'), sha256('GET https://example.test/search?q=jazz'));
  assert.notEqual(sha256('GET https://example.test/search?q=jazz'), sha256('GET https://example.test/search?q=rock'));
  assert.equal(sha256('x').length, 64);
});

test('T02: requestHashFor and argsHashFor are deterministic', () => {
  const url = 'https://hackathon.api.qloo.com/search?query=jazz&take=5';
  assert.equal(requestHashFor('GET', url), requestHashFor('GET', url));
  assert.notEqual(requestHashFor('GET', url), requestHashFor('GET', `${url}&take=6`));
  assert.equal(argsHashFor('qloo_find_tags', { query: 'jazz' }), argsHashFor('qloo_find_tags', { query: 'jazz' }));
  assert.notEqual(argsHashFor('qloo_find_tags', { query: 'jazz' }), argsHashFor('qloo_find_tags', { query: 'rock' }));
});

test('T02: manifest shape is claim -> operation -> requestHash -> requestId -> resultCount, with no replay payload', () => {
  const store = new ReceiptStore();
  store.add({ claim: 'headliner tags', operation: 'qloo_find_tags', requestHash: 'abc', requestId: 'req-1', resultCount: 5, replay: { kind: 'mcp', tool: 'qloo_find_tags', args: {} } });
  const manifest = store.toManifest();
  assert.equal(manifest.length, 1);
  assert.deepEqual(Object.keys(manifest[0]).sort(), ['claim', 'operation', 'requestHash', 'requestId', 'resultCount']);
  assert.equal(manifest[0].requestId, 'req-1');
  assert.equal(manifest[0].resultCount, 5);
});

test('T02: missing requestId is null, never invented', () => {
  const store = new ReceiptStore();
  store.add({ claim: 'Qloo readiness probe', operation: 'qloo_capabilities', requestHash: null, resultCount: 9 });
  assert.equal(store.toManifest()[0].requestId, null);
});
