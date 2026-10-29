// Client/server workspaceId agreement (LEGENDARY integration fix).
// The browser's canonicalBase once hashed baseOffer keys in fixed field
// order while the server's canonicalBaseOffer sorts keys alphabetically,
// so every browser-seeded workspace failed server verification with a
// workspaceId mismatch (verify failed, pure steps refused). These tests
// pin the agreement from both sides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalBaseOffer, computeWorkspaceId } from '../backend/src/workspace.js';

const SAMPLE = {
  artist: 'Test Act', city: 'Test City', venue: null, guarantee: 250000,
  ticketPrice: 120, variableCost: null, variableCostProvided: false,
  capacity: null, capacitySource: null,
};

test('workspace id: server canonical form is sorted-key JSON (lower-cased names)', () => {
  const expected = JSON.stringify({
    artist: 'test act', capacity: null, capacitySource: null, city: 'test city',
    guarantee: 250000, ticketPrice: 120, variableCost: null,
    variableCostProvided: false, venue: null,
  });
  assert.equal(canonicalBaseOffer(SAMPLE), expected);
  assert.match(computeWorkspaceId(SAMPLE, [{ requestHash: 'abc' }]), /^[0-9a-f]{64}$/);
});

test('workspace id: browser canonicalBase sorts its keys before stringifying', async () => {
  const src = await readFile(new URL('../frontend/workspace.js', import.meta.url).pathname, 'utf8');
  const start = src.indexOf('function canonicalBase');
  assert.ok(start !== -1, 'workspace.js must define canonicalBase');
  const body = src.slice(start, start + 1200);
  assert.ok(/Object\.keys\(o\)\.sort\(\)/.test(body),
    'canonicalBase must sort keys (server hashes sorted-key JSON; fixed order diverges)');
});
