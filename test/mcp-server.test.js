// MCP server tests — every tool individually testable via injected
// transports (the same dependency-injection seam the pipeline uses).
// Production code (backend/mcp-server.js) never imports this file or any
// test helper. Network tools get fixture + fail-closed tests here; LIVE
// tests run only when a Qloo key is configured AND the qloo harness is
// present — otherwise they are explicitly SKIPPED, never faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpServer, buildToolDefs } from '../backend/mcp-server.js';
import { argsHashFor, requestHashFor } from '../backend/src/receipts.js';
import { Guards } from '../backend/src/guards.js';
import { ReceiptStore } from '../backend/src/receipts.js';
import { mcpFixture, restFixture, tmEventsNoCapacity, tmEventsWithCapacity, geocodeFixture, wikidataFixture, armsFixture } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SERVER_FILE = path.join(ROOT, 'backend', 'mcp-server.js');

const SPEC_NAMES = [
  'offersheet_verdict_run', 'offersheet_verdict_race',
  'qloo_capabilities', 'qloo_find_tags', 'qloo_describe', 'qloo_recommend', 'qloo_rank',
  'qloo_where_popular', 'qloo_audience_demographics', 'qloo_entity_tags', 'qloo_trends', 'qloo_compare_audiences',
  'offersheet_rest_search', 'offersheet_rest_insights_by_tags', 'offersheet_rest_compare', 'offersheet_rest_entities',
  'offersheet_receipt_replay', 'offersheet_receipt_verify_hash', 'offersheet_receipts_list',
  'offersheet_trials_list', 'offersheet_trial_pack_verify',
  'offersheet_arm_gut', 'offersheet_arm_web', 'offersheet_miss_trial_build',
  'offersheet_venue_search', 'offersheet_room_grounding', 'offersheet_deal_breakeven',
  'offersheet_city_geocode', 'offersheet_artist_facts',
  'offersheet_health', 'offersheet_limits_status',
  'offersheet_opener_shortlist',
];

function baseCfg(overrides = {}) {
  return {
    qlooKeyConfigured: true, tmKeyConfigured: true,
    qlooBaseUrl: 'https://hackathon.api.qloo.com', ticketmasterBaseUrl: 'https://app.ticketmaster.com/discovery/v2',
    osmBaseUrl: 'https://nominatim.openstreetmap.org', wikidataBaseUrl: 'https://www.wikidata.org/w/api.php',
    monthlyCallBudget: 1500, perVisitorDailyCap: 20, perRunCallCap: 40,
    mcpTimeoutMs: 60000, restTimeoutMs: 25000, verdictBudgetMs: 90000,
    ...overrides,
  };
}
function makeServer(overrides = {}) {
  const arms = armsFixture();
  return createMcpServer({
    config: baseCfg(overrides.config),
    guards: overrides.guards || new Guards(),
    receipts: overrides.receipts || new ReceiptStore(),
    mcpCall: overrides.mcpCall !== undefined ? overrides.mcpCall : mcpFixture(overrides.mcpOverrides),
    restCall: overrides.restCall !== undefined ? overrides.restCall : restFixture(overrides.restOverrides),
    tmEvents: overrides.tmEvents !== undefined ? overrides.tmEvents : tmEventsNoCapacity(),
    tmVenues: overrides.tmVenues,
    geocodeFn: overrides.geocodeFn !== undefined ? overrides.geocodeFn : geocodeFixture(),
    wikidataFn: overrides.wikidataFn !== undefined ? overrides.wikidataFn : wikidataFixture(),
    gutArm: overrides.gutArm !== undefined ? overrides.gutArm : arms.gutArm,
    webArm: overrides.webArm !== undefined ? overrides.webArm : arms.webArm,
    llmConfigured: overrides.llmConfigured !== undefined ? overrides.llmConfigured : false,
    ...(overrides.extra || {}),
  });
}
async function call(server, name, args = {}) {
  const res = await server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const text = res.result.content[0].text;
  return { isError: Boolean(res.result.isError), payload: JSON.parse(text), raw: res };
}
function payloadText(p) { return JSON.stringify(p); }

// ---- protocol ------------------------------------------------------------
test('mcp: initialize returns protocol 2024-11-05, tools-only capabilities, offersheet 0.1.0', async () => {
  const s = makeServer();
  const res = await s.handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(res.result.protocolVersion, '2024-11-05');
  assert.deepEqual(res.result.capabilities, { tools: {} });
  assert.deepEqual(res.result.serverInfo, { name: 'offersheet', version: '0.1.0' });
  const notif = await s.handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notif, null);
});

test('mcp: tools/list has exactly 32 entries with the spec names, in order', async () => {
  const s = makeServer();
  const res = await s.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = res.result.tools.map((t) => t.name);
  assert.equal(names.length, 32);
  assert.deepEqual(names, SPEC_NAMES);
  assert.equal(names.filter((n) => n.startsWith('offersheet_')).length, 22);
  assert.equal(names.filter((n) => n.startsWith('qloo_')).length, 10);
  for (const t of res.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.ok(t.description.length > 20);
  }
});

test('mcp: spawned keyless server answers tools/list with 32 tools (real stdio transcript shape)', async () => {
  const child = spawn(process.execPath, [SERVER_FILE], { env: { ...process.env, QLOO_API_KEY: '', TICKETMASTER_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const lines = [];
    const done = new Promise((resolve) => {
      child.stdout.on('data', (d) => {
        for (const line of String(d).split('\n')) {
          if (!line.trim()) continue;
          lines.push(JSON.parse(line));
          if (lines.some((m) => m.id === 2)) resolve();
        }
      });
    });
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await Promise.race([done, new Promise((r) => setTimeout(r, 10000))]);
    const list = lines.find((m) => m.id === 2);
    assert.ok(list, 'tools/list response received over stdio');
    assert.equal(list.result.tools.length, 32);
    assert.deepEqual(list.result.tools.map((t) => t.name), SPEC_NAMES);
  } finally {
    child.kill();
  }
});

test('mcp: unknown tool, unknown argument, and missing required argument are all INVALID_INPUT isError', async () => {
  const s = makeServer();
  const a = await call(s, 'offersheet_nope', {});
  assert.equal(a.isError, true);
  assert.equal(a.payload.code, 'INVALID_INPUT');
  const b = await call(s, 'offersheet_deal_breakeven', { guarantee: 100, ticketPrice: 10, ticketprice: 10 });
  assert.equal(b.isError, true);
  assert.equal(b.payload.code, 'INVALID_INPUT');
  const c = await call(s, 'offersheet_deal_breakeven', { guarantee: 100 });
  assert.equal(c.isError, true);
  assert.equal(c.payload.code, 'INVALID_INPUT');
});

test('mcp: zero disk writes — server source contains no writeFile/appendFile', () => {
  const src = fs.readFileSync(SERVER_FILE, 'utf8');
  assert.ok(!src.includes('writeFile'), 'no writeFile in mcp-server.js');
  assert.ok(!src.includes('appendFile'), 'no appendFile in mcp-server.js');
  assert.ok(!src.includes('writeFileSync'), 'no writeFileSync in mcp-server.js');
});

// ---- verdict tools 1-2 ---------------------------------------------------
test('mcp tool 1: verdict_run with injected transports returns a verdict with 2084 break-even tickets', async () => {
  const s = makeServer();
  const { isError, payload } = await call(s, 'offersheet_verdict_run', { artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120 });
  assert.equal(isError, false);
  assert.equal(payload.status, 'verdict');
  assert.equal(payload.breakEven.tickets, 2084);
  assert.equal(payload.openers.topPick, 'Test Opener One');
  assert.ok(Array.isArray(payload.receipts) && payload.receipts.length > 0);
  assert.equal(payload.missTrial.misses.length, 1);
  assert.equal(payload.missTrial.misses[0].arm, 'gut');
});

test('mcp tool 2: verdict_race returns the verdict plus numeric race timings', async () => {
  const s = makeServer();
  const { isError, payload } = await call(s, 'offersheet_verdict_race', { artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120 });
  assert.equal(isError, false);
  assert.equal(payload.status, 'verdict');
  assert.equal(typeof payload.race.gutMs, 'number');
  assert.equal(typeof payload.race.webMs, 'number');
  assert.equal(payload.race.totalMs, payload.timingMs);
});

test('mcp tools 1-2 fail-closed: keyless verdict returns NOT_CONFIGURED, invalid input spends no live call', async () => {
  let calls = 0;
  const counting = async (tool, args) => { calls += 1; return mcpFixture()(tool, args); };
  const keyless = makeServer({ config: { qlooKeyConfigured: false }, mcpCall: counting });
  const a = await call(keyless, 'offersheet_verdict_run', { artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120 });
  assert.equal(a.isError, true);
  assert.equal(a.payload.code, 'NOT_CONFIGURED');
  const keyed = makeServer({ mcpCall: counting });
  const b = await call(keyed, 'offersheet_verdict_run', { artist: 'Billie Eilish', city: 'New York', guarantee: -5 });
  assert.equal(b.isError, true);
  assert.equal(b.payload.code, 'INVALID_INPUT');
  assert.equal(calls, 0, 'invalid input must not reach a live call');
});

// ---- proxies 3-12 --------------------------------------------------------
const PROXY_CASES = [
  ['qloo_capabilities', {}, 'qloo_capabilities'],
  ['qloo_find_tags', { query: 'Billie Eilish' }, 'qloo_find_tags'],
  ['qloo_describe', { entity: 'Billie Eilish' }, 'qloo_describe'],
  ['qloo_recommend', { target_type: 'artist', signals: ['test-entity-billie'] }, 'qloo_recommend'],
  ['qloo_rank', { options: ['a', 'b'], option_type: 'artist', signals: ['test-entity-billie'] }, 'qloo_rank'],
  ['qloo_where_popular', { entity: 'test-entity-billie' }, 'qloo_where_popular'],
  ['qloo_audience_demographics', { entity: 'test-entity-billie' }, 'qloo_audience_demographics'],
  ['qloo_entity_tags', { entities: ['a', 'b'] }, 'qloo_entity_tags'],
  ['qloo_trends', { entities: ['a'] }, 'qloo_trends'],
  ['qloo_compare_audiences', { group_a: ['a'], group_b: ['b'], target_type: 'artist' }, 'qloo_compare_audiences'],
];
for (const [name, args, tool] of PROXY_CASES) {
  test(`mcp proxy ${name}: envelope passes through with a matching SHA-256 receipt`, async () => {
    const s = makeServer();
    const { isError, payload } = await call(s, name, args);
    assert.equal(isError, false, payloadText(payload));
    assert.equal(payload.envelope.status, 'ok');
    assert.equal(payload.receipt.operation, tool);
    const expectedArgs = name === 'qloo_capabilities' ? {} : (name === 'qloo_describe' ? { entity: args.entity, type: 'artist' } : args);
    assert.equal(payload.receipt.requestHash, argsHashFor(tool, expectedArgs));
    assert.equal(payload.quotaSpent, true);
  });
}
test('mcp proxy qloo_describe: needs_input passes candidates through unguessed', async () => {
  const s = makeServer({ mcpCall: async (tool) => {
    if (tool === 'qloo_describe') return { status: 'needs_input', results: [{ id: 'id-1', name: 'First' }, { id: 'id-2', name: 'Second' }] };
    return mcpFixture()(tool, {});
  } });
  const { payload } = await call(s, 'qloo_describe', { entity: 'Ambiguous Name' });
  assert.equal(payload.status, 'needs_input');
  assert.deepEqual(payload.candidates.map((c) => c.name), ['First', 'Second']);
});
test('mcp proxy qloo_audience_demographics: receipt honestly carries no ids field', async () => {
  const s = makeServer();
  const { payload } = await call(s, 'qloo_audience_demographics', { entity: 'test-entity-billie' });
  assert.equal('ids' in payload.receipt, false);
});
test('mcp proxies fail-closed: keyless returns NOT_CONFIGURED with guard count unchanged; quota floor is terminal', async () => {
  const keyless = makeServer({ config: { qlooKeyConfigured: false } });
  const a = await call(keyless, 'qloo_find_tags', { query: 'Billie Eilish' });
  assert.equal(a.isError, true);
  assert.equal(a.payload.code, 'NOT_CONFIGURED');
  assert.equal(keyless.app.guards.snapshot().monthlyCount, 0);
  const floored = makeServer({ guards: new Guards({ monthlyBudget: 0, perVisitorDailyCap: 20, perRunCallCap: 40 }) });
  const b = await call(floored, 'qloo_find_tags', { query: 'Billie Eilish' });
  assert.equal(b.isError, true);
  assert.equal(b.payload.code, 'QUOTA_FLOOR');
});

// ---- REST tools 13-16 ----------------------------------------------------
test('mcp tool 13: rest_search passes query/take and returns entities', async () => {
  let seen = null;
  const s = makeServer({ restCall: async ({ path, params }) => { seen = { path, params }; return { ok: true, status: 200, requestHash: 'h-search', requestId: null, resultCount: 1, entities: [{ id: 'e1', name: 'Billie Eilish' }], payloadPresent: true }; } });
  const { payload } = await call(s, 'offersheet_rest_search', { query: 'Billie Eilish', take: 5 });
  assert.equal(payload.status, 'ok');
  assert.deepEqual(seen, { path: '/search', params: { query: 'Billie Eilish', take: 5 } });
  assert.equal(payload.entities[0].id, 'e1');
});
test('mcp tool 14: rest_insights_by_tags sends explainability and urn-joined tags', async () => {
  let seen = null;
  const s = makeServer({ restCall: async ({ path, params }) => { seen = { path, params }; return { ok: true, status: 200, requestHash: 'h-ins', requestId: null, resultCount: 0, entities: [], payloadPresent: true }; } });
  await call(s, 'offersheet_rest_insights_by_tags', { tagUrns: ['urn:tag:x:qloo:a', 'urn:tag:y:qloo:b'] });
  assert.equal(seen.params['feature.explainability'], 'true');
  assert.equal(seen.params['signal.interests.tags'], 'urn:tag:x:qloo:a,urn:tag:y:qloo:b');
  const bad = await call(s, 'offersheet_rest_insights_by_tags', { tagUrns: ['not-a-urn'] });
  assert.equal(bad.isError, true);
  assert.equal(bad.payload.code, 'INVALID_INPUT');
});
test('mcp tool 15: rest_compare sends a/b entity params', async () => {
  let seen = null;
  const s = makeServer({ restCall: async ({ path, params }) => { seen = { path, params }; return { ok: true, status: 200, requestHash: 'h-cmp', requestId: null, resultCount: null, entities: [], payloadPresent: true }; } });
  await call(s, 'offersheet_rest_compare', { aIds: ['a1'], bIds: ['b1'] });
  assert.equal(seen.path, '/v2/analysis/compare');
  assert.equal(seen.params['a.signal.interests.entities'], 'a1');
  assert.equal(seen.params['b.signal.interests.entities'], 'b1');
});
test('mcp tool 16: rest_entities enforces the 15-ID cap', async () => {
  let seen = null;
  const s = makeServer({ restCall: async ({ path, params }) => { seen = { path, params }; return { ok: true, status: 200, requestHash: 'h-ent', requestId: null, resultCount: 15, entities: [], payloadPresent: true }; } });
  const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
  const { payload } = await call(s, 'offersheet_rest_entities', { ids });
  assert.equal(payload.idsRequested, 20);
  assert.equal(payload.idsSent, 15);
  assert.equal(seen.params.entity_ids.split(',').length, 15);
});
test('mcp REST tools fail-closed: keyless NOT_CONFIGURED, 5xx isError after transport', async () => {
  const keyless = makeServer({ config: { qlooKeyConfigured: false } });
  const a = await call(keyless, 'offersheet_rest_search', { query: 'X' });
  assert.equal(a.payload.code, 'NOT_CONFIGURED');
  const failing = makeServer({ restCall: async () => ({ ok: false, status: 503, requestHash: null, requestId: null, resultCount: null, entities: [] }) });
  const b = await call(failing, 'offersheet_rest_search', { query: 'X' });
  assert.equal(b.isError, true);
  assert.equal(b.payload.code, 'QLOO_ERROR');
  assert.match(b.payload.message, /503/);
});

// ---- receipts 17-19 ------------------------------------------------------
test('mcp tool 17: key gate precedes validation — keyless bogus replay is NOT_CONFIGURED, not INVALID_INPUT', async () => {
  let calls = 0;
  const s = makeServer({ config: { qlooKeyConfigured: false }, mcpCall: async () => { calls += 1; return {}; } });
  const { payload, isError } = await call(s, 'offersheet_receipt_replay', { kind: 'mcp', tool: 'qloo_bogus', args: {} });
  assert.equal(isError, true);
  assert.equal(payload.code, 'NOT_CONFIGURED');
  assert.equal(calls, 0);
});
test('mcp tool 17: non-allowlisted replay is INVALID_INPUT before any live call', async () => {
  let calls = 0;
  const s = makeServer({ mcpCall: async () => { calls += 1; return {}; } });
  const a = await call(s, 'offersheet_receipt_replay', { kind: 'mcp', tool: 'qloo_bogus', args: {} });
  assert.equal(a.payload.code, 'INVALID_INPUT');
  const b = await call(s, 'offersheet_receipt_replay', { kind: 'rest', path: '/evil', params: {} });
  assert.equal(b.payload.code, 'INVALID_INPUT');
  const c = await call(s, 'offersheet_receipt_replay', { kind: 'rest', path: 'https://example.test/search', params: {} });
  assert.equal(c.payload.code, 'INVALID_INPUT');
  assert.equal(calls, 0);
});
test('mcp tool 17: replay comparison — match, mismatch, and not_comparable (no IDs, no empty match)', async () => {
  const s = makeServer();
  const match = await call(s, 'offersheet_receipt_replay', { kind: 'mcp', tool: 'qloo_describe', args: { entity: 'Billie Eilish', type: 'artist' }, originalIds: ['test-entity-billie'] });
  assert.equal(match.payload.comparison.status, 'match');
  const mismatch = await call(s, 'offersheet_receipt_replay', { kind: 'mcp', tool: 'qloo_describe', args: { entity: 'Billie Eilish', type: 'artist' }, originalIds: ['other-id'] });
  assert.equal(mismatch.payload.comparison.status, 'mismatch');
  const noIds = await call(s, 'offersheet_receipt_replay', { kind: 'mcp', tool: 'qloo_describe', args: { entity: 'Billie Eilish', type: 'artist' } });
  assert.equal(noIds.payload.comparison.status, 'not_comparable');
  const bands = await call(s, 'offersheet_receipt_replay', { kind: 'mcp', tool: 'qloo_audience_demographics', args: { entity: 'x' }, originalIds: [] });
  assert.equal(bands.payload.comparison.status, 'not_comparable', 'empty fresh IDs must never report a match');
  const rest = await call(s, 'offersheet_receipt_replay', { kind: 'rest', path: '/search', params: { query: 'Billie Eilish', take: 5 }, originalIds: ['test-entity-billie'] });
  assert.equal(rest.payload.comparison.status, 'match');
});
test('mcp tool 18: hash verify — known vector matches, tampered args mismatch, REST url hash matches', async () => {
  const s = makeServer();
  const goodArgs = { query: 'Billie Eilish', limit: 10 };
  const good = await call(s, 'offersheet_receipt_verify_hash', { operation: 'qloo_find_tags', requestHash: argsHashFor('qloo_find_tags', goodArgs), tool: 'qloo_find_tags', args: goodArgs });
  assert.equal(good.payload.valid, true);
  assert.equal(good.payload.recomputedHash, argsHashFor('qloo_find_tags', goodArgs));
  const bad = await call(s, 'offersheet_receipt_verify_hash', { operation: 'qloo_find_tags', requestHash: argsHashFor('qloo_find_tags', goodArgs), tool: 'qloo_find_tags', args: { query: 'Taylor Swift', limit: 10 } });
  assert.equal(bad.payload.valid, false);
  const rest = await call(s, 'offersheet_receipt_verify_hash', { operation: 'rest:/search', requestHash: requestHashFor('GET', 'https://example.test/search?query=X'), method: 'GET', url: 'https://example.test/search?query=X' });
  assert.equal(rest.payload.valid, true);
  assert.equal(rest.payload.hashKind, 'url');
  const missing = await call(s, 'offersheet_receipt_verify_hash', { operation: 'x', requestHash: 'abc' });
  assert.equal(missing.payload.code, 'INVALID_INPUT');
});
test('mcp tool 19: receipts_list session selectors + manifest source returns the real empty manifest verbatim', async () => {
  const s = makeServer();
  await call(s, 'qloo_find_tags', { query: 'Billie Eilish' });
  const all = await call(s, 'offersheet_receipts_list', { source: 'session' });
  assert.equal(all.payload.receipts.length, 1);
  assert.equal(all.payload.receipts[0].operation, 'qloo_find_tags');
  const filtered = await call(s, 'offersheet_receipts_list', { source: 'session', operation: 'qloo_describe' });
  assert.equal(filtered.payload.receipts.length, 0);
  const byHash = await call(s, 'offersheet_receipts_list', { source: 'session', requestHash: all.payload.receipts[0].requestHash });
  assert.equal(byHash.payload.receipts.length, 1);
  const manifest = await call(s, 'offersheet_receipts_list', { source: 'manifest' });
  assert.deepEqual(manifest.payload.manifest, []);
  assert.match(manifest.payload.note, /empty manifest means no run has been recorded yet/);
  assert.match(manifest.payload.note, /never contains credentials/);
});

// ---- trials 20-21 --------------------------------------------------------
test('mcp tool 20: trials_list returns 3 recorded trials, index is the get, out-of-range is INVALID_INPUT', async () => {
  const s = makeServer();
  const all = await call(s, 'offersheet_trials_list', {});
  assert.equal(all.payload.label, 'recorded, not live');
  assert.equal(all.payload.runs.length, 3);
  const one = await call(s, 'offersheet_trials_list', { index: 0 });
  assert.equal(one.payload.run.graphPick, 'Olivia Rodrigo');
  assert.equal(one.payload.label, 'recorded, not live');
  const bad = await call(s, 'offersheet_trials_list', { index: 99 });
  assert.equal(bad.payload.code, 'INVALID_INPUT');
});
test('mcp tool 21: trial_pack_verify passes on the real pack and names the failed check on a tampered copy', async () => {
  const s = makeServer();
  const good = await call(s, 'offersheet_trial_pack_verify', {});
  assert.equal(good.payload.allPassed, true, payloadText(good.payload.checks));
  assert.equal(good.payload.status, 'ok');
  assert.ok(good.payload.checks.every((c) => c.passed));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offersheet-pack-'));
  const tamperedPath = path.join(dir, 'trial-pack.json');
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend', 'trial-pack.json'), 'utf8'));
  pack.trials[0].breakEvenTickets = 9999;
  fs.writeFileSync(tamperedPath, JSON.stringify(pack));
  const bad = await call(s, 'offersheet_trial_pack_verify', { packPath: tamperedPath });
  assert.equal(bad.payload.allPassed, false);
  assert.equal(bad.payload.status, 'mismatch');
  assert.ok(bad.payload.checks.some((c) => !c.passed), 'tamper must fail at least one named check');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- arms 22-24 ----------------------------------------------------------
test('mcp tool 22: arm_gut returns the injected pick', async () => {
  const s = makeServer();
  const { payload } = await call(s, 'offersheet_arm_gut', { question: 'Headliner X in Y. Who is the best opening act?' });
  assert.equal(payload.status, 'ok');
  assert.equal(payload.pick, 'Test Opener Two');
});
test('mcp tool 22 fail-closed: unavailable gut arm returns unavailable, never a pick', async () => {
  const s = makeServer({ gutArm: async () => ({ arm: 'gut', status: 'unavailable', reason: 'LLM arm not configured — no pick rendered' }) });
  const { isError, payload } = await call(s, 'offersheet_arm_gut', { question: 'Q?' });
  assert.equal(isError, false);
  assert.equal(payload.status, 'unavailable');
  assert.equal(payload.pick, undefined);
});
test('mcp tool 23: arm_web uses only caller-supplied facts, and fetches Wikidata facts when artist is given', async () => {
  let seenFacts = null;
  const s = makeServer({ webArm: async ({ webFacts }) => { seenFacts = webFacts; return { arm: 'web', status: 'ok', pick: 'Fact Pick', provider: 'test' }; } });
  await call(s, 'offersheet_arm_web', { question: 'Q?', webFacts: ['Fact A', 'Fact B'] });
  assert.deepEqual(seenFacts, ['Fact A', 'Fact B']);
  await call(s, 'offersheet_arm_web', { question: 'Q?', artist: 'Billie Eilish' });
  assert.ok(seenFacts.some((f) => f.includes('Billie Eilish')), 'Wikidata facts must reach the Web arm');
});
test('mcp tool 24: miss_trial_build — all pick combinations', async () => {
  const s = makeServer();
  const only = await call(s, 'offersheet_miss_trial_build', { question: 'Q?', graphPick: 'G' });
  assert.equal(only.payload.trial, null);
  const gutMiss = await call(s, 'offersheet_miss_trial_build', { question: 'Q?', graphPick: 'G', gutPick: 'H' });
  assert.equal(gutMiss.payload.trial.misses.length, 1);
  assert.equal(gutMiss.payload.trial.misses[0].arm, 'gut');
  const same = await call(s, 'offersheet_miss_trial_build', { question: 'Q?', graphPick: 'G', gutPick: 'G', webPick: 'G' });
  assert.deepEqual(same.payload.trial.misses, []);
  const webOnly = await call(s, 'offersheet_miss_trial_build', { question: 'Q?', graphPick: 'G', webPick: 'W' });
  assert.equal(webOnly.payload.trial.misses.length, 1);
  assert.equal(webOnly.payload.trial.misses[0].arm, 'web');
});

// ---- room/money/city/facts 25-29 ----------------------------------------
test('mcp tool 25: venue_search — not_configured keyless, resolved record keyed, empty body means did-not-resolve', async () => {
  const keyless = makeServer({ config: { tmKeyConfigured: false } });
  const a = await call(keyless, 'offersheet_venue_search', { keyword: 'Test Room' });
  assert.equal(a.payload.status, 'not_configured');
  assert.equal(a.payload.venue, null);
  const keyed = makeServer({ tmVenues: async () => ({ ok: true, status: 200, body: { _embedded: { venues: [{ id: 'v1', name: 'Test Room', capacity: 600 }] } } }) });
  const b = await call(keyed, 'offersheet_venue_search', { keyword: 'Test Room' });
  assert.equal(b.payload.status, 'ok');
  assert.equal(b.payload.venue.name, 'Test Room');
  const empty = makeServer({ tmVenues: async () => ({ ok: true, status: 200, body: { _embedded: { venues: [] } } }) });
  const c = await call(empty, 'offersheet_venue_search', { keyword: 'Nowhere Room' });
  assert.equal(c.payload.status, 'empty');
  assert.equal(c.payload.venue, null);
});
test('mcp tool 26: room_grounding — resolved room capacity is never borrowed from another room event; first-event path is labeled not-the-offer-room', async () => {
  let scopedVenueId = null;
  const resolved = makeServer({
    tmVenues: async () => ({ ok: true, status: 200, body: { _embedded: { venues: [{ id: 'v1', name: 'Test Room', capacity: 600 }] } } }),
    tmEvents: async ({ venueId }) => { scopedVenueId = venueId; return { ok: true, status: 200, body: { _embedded: { events: [{ _embedded: { venues: [{ name: 'Other Room', capacity: 999 }] }, priceRanges: [{ min: 100, max: 140, currency: 'USD' }] }] } } }; },
  });
  const a = await call(resolved, 'offersheet_room_grounding', { artist: 'Billie Eilish', city: 'New York', venue: 'Test Room' });
  assert.equal(scopedVenueId, 'v1', 'event lookup must be scoped to the resolved venue ID');
  assert.equal(a.payload.capacity.value, 600, 'resolved room capacity wins over the event venue capacity');
  assert.match(a.payload.grounding, /named room/);
  assert.equal(a.payload.price.value, 120);
  const first = makeServer();
  const b = await call(first, 'offersheet_room_grounding', { artist: 'Billie Eilish', city: 'New York' });
  assert.match(b.payload.grounding, /not the offer room/);
  assert.equal(b.payload.capacity.value, null, 'no-capacity venue fixture yields unknown capacity');
  const keyless = makeServer({ config: { tmKeyConfigured: false } });
  const c = await call(keyless, 'offersheet_room_grounding', { artist: 'X', city: 'Y' });
  assert.equal(c.payload.status, 'not_configured');
  assert.equal(c.payload.capacity.value, null);
});
test('mcp tool 27: deal_breakeven edge table', async () => {
  const s = makeServer();
  const cases = [
    [{ guarantee: 250000, ticketPrice: 120 }, 2084, null],
    [{ guarantee: 0, ticketPrice: 120 }, 0, 'no guarantee'],
    [{ guarantee: 12000, ticketPrice: 120 }, 100, null],
    [{ guarantee: 12001, ticketPrice: 120 }, 101, null],
    [{ guarantee: 10000, ticketPrice: 120, capacity: 50 }, 84, null],
  ];
  for (const [args, tickets, note] of cases) {
    const { payload } = await call(s, 'offersheet_deal_breakeven', args);
    assert.equal(payload.tickets, tickets, JSON.stringify(args));
    assert.equal(payload.note, note);
  }
  const over = await call(s, 'offersheet_deal_breakeven', { guarantee: 10000, ticketPrice: 120, capacity: 50 });
  assert.equal(over.payload.verdict, 'Cannot break even in this room at this guarantee');
  const netZero = await call(s, 'offersheet_deal_breakeven', { guarantee: 100, ticketPrice: 10, variableCost: 10 });
  assert.equal(netZero.payload.code, 'INVALID_INPUT');
  const missingPrice = await call(s, 'offersheet_deal_breakeven', { guarantee: 100 });
  assert.equal(missingPrice.payload.code, 'INVALID_INPUT');
  const blank = await call(s, 'offersheet_deal_breakeven', { guarantee: 120, ticketPrice: 120 });
  assert.deepEqual(blank.payload.variableCost, { value: null, provided: false });
  const zero = await call(s, 'offersheet_deal_breakeven', { guarantee: 120, ticketPrice: 120, variableCost: 0 });
  assert.deepEqual(zero.payload.variableCost, { value: 0, provided: true });
});
test('mcp tool 28: city_geocode returns display name/lat/lon with the display-only scope; failure is unavailable, never guessed', async () => {
  const s = makeServer();
  const { payload } = await call(s, 'offersheet_city_geocode', { query: 'New York' });
  assert.equal(payload.status, 'ok');
  assert.equal(payload.displayName, 'New York, USA');
  assert.match(payload.scope, /display-only/);
  const down = makeServer({ geocodeFn: async () => ({ ok: false, status: 503, result: null }) });
  const b = await call(down, 'offersheet_city_geocode', { query: 'Nowhere' });
  assert.equal(b.payload.status, 'unavailable');
  assert.equal(b.payload.result, null);
});
test('mcp tool 29: artist_facts returns id/label/description with the Web-arm-only scope; failure is an error state', async () => {
  const s = makeServer();
  const { payload } = await call(s, 'offersheet_artist_facts', { query: 'Billie Eilish' });
  assert.equal(payload.status, 'ok');
  assert.equal(payload.results[0].id, 'Q-test');
  assert.match(payload.scope, /Web arm only/);
  const down = makeServer({ wikidataFn: async () => ({ ok: false, status: 503, results: [] }) });
  const b = await call(down, 'offersheet_artist_facts', { query: 'X' });
  assert.equal(b.payload.status, 'error');
  assert.deepEqual(b.payload.results, []);
});

// ---- health/limits 30-31 -------------------------------------------------
test('mcp tool 30: health with empty env — all three booleans false, no key material', async () => {
  const s = makeServer({ config: { qlooKeyConfigured: false, tmKeyConfigured: false }, llmConfigured: false });
  const { payload } = await call(s, 'offersheet_health', {});
  assert.deepEqual({ q: payload.qlooConfigured, t: payload.ticketmasterConfigured, l: payload.llmConfigured }, { q: false, t: false, l: false });
  assert.equal(payload.status, 'ok');
  assert.ok(!payloadText(payload).includes('API_KEY'), 'health output must not mention key names');
  const keyed = makeServer({ llmConfigured: true });
  const k = await call(keyed, 'offersheet_health', {});
  assert.deepEqual({ q: k.payload.qlooConfigured, t: k.payload.ticketmasterConfigured, l: k.payload.llmConfigured }, { q: true, t: true, l: true });
});
test('mcp tool 31: limits_status snapshot, adopted-not-Qloo label, restart-clears note, and count advances by exactly 1 per guarded call', async () => {
  const s = makeServer();
  const before = await call(s, 'offersheet_limits_status', {});
  assert.equal(before.payload.monthlyCount, 0);
  assert.equal(before.payload.monthlyBudget, 1500);
  assert.match(before.payload.note, /NOT Qloo-stated quotas/);
  assert.match(before.payload.note, /Restart clears/);
  await call(s, 'qloo_find_tags', { query: 'Billie Eilish' });
  const after = await call(s, 'offersheet_limits_status', {});
  assert.equal(after.payload.monthlyCount, 1);
  // Offline tools spend no quota.
  await call(s, 'offersheet_receipt_verify_hash', { operation: 'x', requestHash: 'y', tool: 'qloo_find_tags', args: {} });
  await call(s, 'offersheet_miss_trial_build', { question: 'Q?', graphPick: 'G' });
  await call(s, 'offersheet_deal_breakeven', { guarantee: 100, ticketPrice: 10 });
  const afterOffline = await call(s, 'offersheet_limits_status', {});
  assert.equal(afterOffline.payload.monthlyCount, 1);
});

// ---- composed chain 32 (LOAD-BEARING) ------------------------------------
test('mcp tool 32: opener_shortlist — rank consumes recommend output exactly, with receipts for each step', async () => {
  const calls = [];
  const s = makeServer({ mcpCall: async (tool, args) => { calls.push([tool, args]); return mcpFixture()(tool, args); } });
  const { isError, payload } = await call(s, 'offersheet_opener_shortlist', { artist: 'Billie Eilish', city: 'New York' });
  assert.equal(isError, false, payloadText(payload));
  assert.equal(payload.status, 'ok');
  assert.deepEqual(payload.candidates.map((c) => c.name), ['Test Opener One', 'Test Opener Two']);
  assert.equal(payload.topPick, 'Test Opener One');
  const rankCall = calls.find(([t]) => t === 'qloo_rank');
  assert.deepEqual(rankCall[1].options, ['test-entity-opener-1', 'test-entity-opener-2'], 'rank options must equal recommend output exactly');
  assert.equal(rankCall[1].signal_location, 'New York');
  assert.equal(payload.receipts.length, 3, 'describe + recommend + rank receipts');
  assert.deepEqual(payload.receipts.map((r) => r.operation), ['qloo_describe', 'qloo_recommend', 'qloo_rank']);
});
test('mcp tool 32: ID-less candidate triggers one describe threading call; recommend-empty skips rank honestly', async () => {
  const calls = [];
  const s = makeServer({ mcpCall: async (tool, args) => {
    calls.push([tool, args]);
    if (tool === 'qloo_describe' && args.entity === 'NoId Opener') return { status: 'ok', results: [{ id: 'resolved-noid', name: 'NoId Opener' }] };
    if (tool === 'qloo_describe') return { status: 'ok', results: [{ id: 'test-entity-billie', name: 'Billie Eilish' }] };
    if (tool === 'qloo_recommend') return { status: 'ok', results: [{ name: 'NoId Opener' }] };
    if (tool === 'qloo_rank') return { status: 'ok', results: [{ name: 'NoId Opener' }] };
    return mcpFixture()(tool, args);
  } });
  const { payload } = await call(s, 'offersheet_opener_shortlist', { artist: 'Billie Eilish', city: 'New York' });
  assert.equal(payload.topPickId, 'resolved-noid', 'ID threading must resolve the ID-less top pick');
  assert.equal(calls.filter(([t, a]) => t === 'qloo_describe' && a.entity === 'NoId Opener').length, 1);
  const empty = makeServer({ mcpCall: async (tool, args) => {
    if (tool === 'qloo_recommend') return { status: 'ok', results: [] };
    return mcpFixture()(tool, args);
  } });
  const e = await call(empty, 'offersheet_opener_shortlist', { artist: 'Billie Eilish', city: 'New York' });
  assert.equal(e.payload.rank.status, 'skipped');
  assert.equal(e.payload.topPick, null);
  const keyless = makeServer({ config: { qlooKeyConfigured: false } });
  const k = await call(keyless, 'offersheet_opener_shortlist', { artist: 'Billie Eilish', city: 'New York' });
  assert.equal(k.payload.code, 'NOT_CONFIGURED');
});

// ---- live tests: explicitly skipped without a key + harness ---------------
const hasLive = Boolean(process.env.QLOO_API_KEY) && (() => { try { return spawnSync('qloo', ['--version'], { encoding: 'utf8' }).status === 0; } catch { return false; } })();
const liveTest = hasLive ? test : test.skip;
liveTest('mcp LIVE: real harness answers qloo_capabilities (skipped without key + harness)', async () => {
  const s = createMcpServer();
  const { isError, payload } = await call(s, 'qloo_capabilities', {});
  assert.equal(isError, false, payloadText(payload));
  assert.ok(Array.isArray(payload.envelope.operations) || payload.envelope.status === 'ok');
});
liveTest('mcp LIVE: real verdict run (skipped without key + harness)', async () => {
  const s = createMcpServer();
  const { payload } = await call(s, 'offersheet_verdict_run', { artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120 });
  assert.ok(['verdict', 'verdict_withheld', 'price_unknown', 'needs_input'].includes(payload.status));
});
