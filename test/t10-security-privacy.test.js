// T10 (security + privacy): no personal data reaches any upstream on any
// path, and LLM arms carry only the question + Wikidata facts.
// Every outbound payload of one full fixture verdict run is captured and
// scanned for canaries the pipeline must never forward: the visitor IP
// (guard-only by design), an email-shaped string, and a device-id string.
// The verdict RESPONSE is scanned for the visitor IP as well: guards use
// the IP in memory only, and it must never be echoed back or forwarded.
// The LLM provider flow is asserted separately with a recording fetch:
// env-only configuration, Bearer interpolation only, and prompts that
// contain exactly the question (Gut) or the question + supplied facts
// (Web) — never anything else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerdict } from '../backend/src/pipeline.js';
import { runGutArm, runWebArm } from '../backend/src/arms.js';
import { REST_PARAM_ALLOWLIST } from '../backend/src/rest.js';
import { baseDeps, baseInput } from './fixtures.js';

const VISITOR_IP = '203.0.113.99';
const EMAIL_CANARY = 'promoter@example.invalid';
const DEVICE_CANARY = 'device-9f27c1a4';

function scan(obj) {
  return JSON.stringify(obj ?? null);
}

test('T10 privacy: a full verdict run sends no visitor IP, email, or device id to any upstream, and echoes no IP in the response', async () => {
  const bare = baseDeps();
  const seen = { mcp: [], rest: [], tmEvents: [], tmVenues: [], geocode: [], wikidata: [], gut: [], web: [], guard: [] };
  const deps = {
    ...bare,
    checkVisitor: (ip) => { seen.guard.push(ip); },
    mcpCall: async (tool, args) => { seen.mcp.push({ tool, args }); return bare.mcpCall(tool, args); },
    restCall: async (input) => { seen.rest.push(input); return bare.restCall(input); },
    tmEvents: async (input) => { seen.tmEvents.push(input); return bare.tmEvents(input); },
    tmVenues: async (input) => {
      seen.tmVenues.push(input);
      return { ok: true, status: 200, body: { _embedded: { venues: [{ id: 'test-venue-1', name: 'Test Room' }] } } };
    },
    geocodeFn: async (input) => { seen.geocode.push(input); return bare.geocodeFn(input); },
    wikidataFn: async (input) => { seen.wikidata.push(input); return bare.wikidataFn(input); },
    gutArm: async (input) => { seen.gut.push(input); return bare.gutArm(input); },
    webArm: async (input) => { seen.web.push(input); return bare.webArm(input); },
  };
  const input = baseInput({ venue: 'Test Room', visitorIp: VISITOR_IP });
  const verdict = await runVerdict(input, deps);
  assert.equal(verdict.status, 'verdict', 'fixture run must reach a verdict so every path is exercised');
  // The guard path — and ONLY the guard path — receives the IP.
  assert.deepEqual(seen.guard, [VISITOR_IP]);
  const outbound = [seen.mcp, seen.rest, seen.tmEvents, seen.tmVenues, seen.geocode, seen.wikidata, seen.gut, seen.web];
  for (const bucket of outbound) {
    assert.ok(!scan(bucket).includes(VISITOR_IP), `outbound payload must not contain the visitor IP: ${scan(bucket).slice(0, 200)}`);
    assert.ok(!scan(bucket).includes(EMAIL_CANARY), 'outbound payload must not contain an email');
    assert.ok(!scan(bucket).includes(DEVICE_CANARY), 'outbound payload must not contain a device id');
  }
  assert.ok(!scan(verdict).includes(VISITOR_IP), 'verdict response must not echo the visitor IP');
  // REST legs pass only allowlisted params (the caller gate, not just the
  // wrappers): a typo'd param would fail closed in qlooRest, and these
  // recorded params prove the pipeline only ever sends allowlisted keys.
  for (const call of seen.rest) {
    const allowed = REST_PARAM_ALLOWLIST[call.path];
    assert.ok(Array.isArray(allowed), `recorded REST path must be allowlisted: ${call.path}`);
    for (const k of Object.keys(call.params || {})) {
      assert.ok(allowed.includes(k), `REST param ${k} for ${call.path} must be allowlisted`);
    }
  }
  // Upstream call shapes: each leg carries only its own inputs.
  for (const call of seen.geocode) assert.deepEqual(Object.keys(call), ['query']);
  for (const call of seen.wikidata) assert.deepEqual(Object.keys(call), ['query']);
  for (const call of seen.tmEvents) {
    for (const k of Object.keys(call)) assert.ok(['keyword', 'city', 'venueId'].includes(k), `Ticketmaster events arg ${k} is unexpected`);
  }
  for (const call of seen.tmVenues) assert.deepEqual(Object.keys(call), ['keyword']);
  // LLM arms: the pipeline question is the fixed template (artist + city
  // only), and Web facts are exactly the Wikidata-derived strings.
  const expectedQuestion = 'Headliner Billie Eilish in New York. Who is the best opening act for this audience?';
  assert.equal(seen.gut.length, 1);
  assert.equal(seen.gut[0].question, expectedQuestion);
  assert.equal(seen.web.length, 1);
  assert.equal(seen.web[0].question, expectedQuestion);
  assert.deepEqual(seen.web[0].webFacts, ['Billie Eilish — American singer (Q-test)']);
  // Receipt replay payloads in the verdict carry no IP either.
  for (const r of verdict.receipts || []) {
    assert.ok(!scan(r.replay).includes(VISITOR_IP), 'receipt replay payload must not contain the visitor IP');
  }
});

test('T10 privacy: LLM arms use env-only config, Bearer interpolation, and prompts of question (+ facts) only', async () => {
  const saved = {};
  for (const k of ['AI_PRIMARY_PROVIDER', 'AI_FALLBACK_PROVIDERS', 'TESTPROV_BASE_URL', 'TESTPROV_API_KEY', 'TESTPROV_MODEL', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.AI_PRIMARY_PROVIDER = 'testprov';
  process.env.TESTPROV_BASE_URL = 'https://example.invalid';
  process.env.TESTPROV_API_KEY = 'test-only-fake-key';
  process.env.TESTPROV_MODEL = 'test-model';
  try {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Test Opener One' } }] }) };
    };
    const question = 'Headliner Billie Eilish in New York. Who is the best opening act for this audience?';
    const gut = await runGutArm({ question, fetchImpl });
    assert.equal(gut.status, 'ok');
    const web = await runWebArm({ question, webFacts: ['Billie Eilish — American singer (Q-test)'], fetchImpl });
    assert.equal(web.status, 'ok');
    assert.equal(calls.length, 2);
    for (const c of calls) {
      assert.equal(c.url, 'https://example.invalid/chat/completions');
      assert.equal(c.headers.Authorization, 'Bearer test-only-fake-key');
      assert.equal(c.body.model, 'test-model');
      assert.deepEqual(Object.keys(c.body).sort(), ['messages', 'model']);
      assert.equal(c.body.messages.length, 1);
      assert.equal(c.body.messages[0].role, 'user');
    }
    // Gut: the question only — no facts, no IP, no email, no device id.
    assert.ok(calls[0].body.messages[0].content.includes(question));
    assert.ok(!calls[0].body.messages[0].content.includes('Q-test'));
    assert.ok(!calls[0].body.messages[0].content.includes(VISITOR_IP));
    // Web: exactly the fixed template — question + supplied facts, nothing else.
    assert.equal(
      calls[1].body.messages[0].content,
      `Pick ONE opening act for this live-show question using ONLY the Wikidata facts below (no Qloo taste data). Question: ${question}\nFacts:\n- Billie Eilish — American singer (Q-test)`,
    );
    assert.ok(!calls[1].body.messages[0].content.includes(VISITOR_IP));
    assert.ok(!calls[1].body.messages[0].content.includes(EMAIL_CANARY));
    assert.ok(!calls[1].body.messages[0].content.includes(DEVICE_CANARY));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
