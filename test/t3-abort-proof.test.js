// Track3 patch 02 proof: every leg's fetch receives the abort signal, so a
// timer abort rejects the leg instead of leaving it hanging. The stub
// rejects exactly when its signal aborts (the production behaviour the
// timer drives); a leg that never wired the signal would hang past the
// test's own patience and fail by timeout instead of rejecting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchEvents, searchVenues } from '../backend/src/ticketmaster.js';
import { geocode } from '../backend/src/osm.js';
import { searchEntities } from '../backend/src/wikidata.js';

function abortRejectingFetch() {
  return (url, opts = {}) => new Promise((resolve, reject) => {
    const sig = opts.signal;
    if (sig && sig.aborted) return reject(new Error('aborted'));
    if (sig) sig.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    // Never resolve on its own: only the abort can settle this stub.
  });
}

test('t3-02: Ticketmaster searchEvents rejects on abort signal', async () => {
  await assert.rejects(
    searchEvents({ keyword: 'x', city: 'y', key: 'k', baseUrl: 'https://example.invalid', fetchImpl: abortRejectingFetch(), timeoutMs: 5 }),
    /aborted/);
});

test('t3-02: Ticketmaster searchVenues rejects on abort signal', async () => {
  await assert.rejects(
    searchVenues({ keyword: 'x', key: 'k', baseUrl: 'https://example.invalid', fetchImpl: abortRejectingFetch(), timeoutMs: 5 }),
    /aborted/);
});

test('t3-02: OSM geocode rejects on abort signal', async () => {
  await assert.rejects(
    geocode({ query: 'New York', baseUrl: 'https://example.invalid', fetchImpl: abortRejectingFetch(), timeoutMs: 5 }),
    /aborted/);
});

test('t3-02: Wikidata searchEntities rejects on abort signal', async () => {
  await assert.rejects(
    searchEntities({ query: 'x', baseUrl: 'https://example.invalid', fetchImpl: abortRejectingFetch(), timeoutMs: 5 }),
    /aborted/);
});
