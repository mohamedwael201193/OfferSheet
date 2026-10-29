// Coordinator final pass — G11 production wiring proof (static, T16 style).
// server.js listens on import, so it cannot be imported by a test; instead
// this asserts the production source actually wires tmVenues into buildDeps.
// Pipeline injection tests (money-ground-truth.test.js) prove the behavior
// once tmVenues is present; this test proves production presents it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SERVER = new URL('../backend/server.js', import.meta.url).pathname;

test('G11 wiring: server.js imports searchVenues from ticketmaster.js', async () => {
  const src = await readFile(SERVER, 'utf8');
  assert.ok(
    src.includes("searchVenues } from './src/ticketmaster.js'") ||
      src.includes('searchVenues,') ||
      src.includes('searchVenues }'),
    'server.js must import searchVenues',
  );
  assert.ok(src.includes("from './src/ticketmaster.js'"), 'ticketmaster import present');
});

test('G11 wiring: buildDeps passes tmVenues built from searchVenues + Ticketmaster key', async () => {
  const src = await readFile(SERVER, 'utf8');
  assert.ok(src.includes('tmVenues:'), 'buildDeps must define tmVenues');
  const idx = src.indexOf('tmVenues:');
  const window = src.slice(idx, idx + 300);
  assert.ok(window.includes('searchVenues'), 'tmVenues must call searchVenues');
  assert.ok(window.includes('config.ticketmasterKey'), 'tmVenues must use the Ticketmaster key');
  assert.ok(window.includes('config.ticketmasterBaseUrl'), 'tmVenues must use the Ticketmaster base URL');
});

test('G11 wiring: pipeline still falls back honestly when tmVenues is absent', async () => {
  const pipeline = await readFile(
    new URL('../backend/src/pipeline.js', import.meta.url).pathname,
    'utf8',
  );
  assert.ok(
    pipeline.includes('!deps.tmVenues'),
    'pipeline must keep the honest not-wired fallback branch as a safety net',
  );
});
