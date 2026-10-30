// Optional fixed-cost stack. A blank field is left out of the sum.
// An explicit 0 is entered zero. With every new field blank, the
// $250,000 / $120 count stays 2,084 and the result object has no
// fixedCosts key.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { breakEven } from '../backend/src/breakeven.js';
import { runVerdict } from '../backend/src/pipeline.js';
import { requestHashFor } from '../backend/src/receipts.js';
import { buildToolDefs, createMcpServer } from '../backend/mcp-server.js';
import { Guards } from '../backend/src/guards.js';
import { ReceiptStore } from '../backend/src/receipts.js';
import {
  buildWorkspace, verifyWorkspace, runComparison, computeWorkspaceId, restUrlFor,
  QLOO_DEFAULT_BASE_URL,
} from '../backend/src/workspace.js';
import { baseDeps, baseInput } from './fixtures.js';
import { spawnEphemeralBackend } from './ephemeral-backend.js';

function fixRestHashes(verdict) {
  for (const r of verdict.receipts || []) {
    if (r.replay?.kind === 'rest') {
      r.requestHash = requestHashFor('GET', restUrlFor(r.replay.path, r.replay.params || {}, QLOO_DEFAULT_BASE_URL));
    }
  }
  return verdict;
}

const BLANK_2084 = {
  tickets: 2084,
  note: null,
  verdict: null,
  net: 120,
  capacity: null,
  variableCost: 0,
};

test('fixed stack: blank fields leave the 2,084 result unchanged', () => {
  assert.deepEqual(breakEven({ guarantee: 250000, ticketPrice: 120 }), BLANK_2084);
  assert.deepEqual(breakEven({ guarantee: 250000, ticketPrice: 120, roomCost: undefined, productionCost: null }), BLANK_2084);
  assert.equal(Object.hasOwn(breakEven({ guarantee: 250000, ticketPrice: 120 }), 'fixedCosts'), false);
});

test('fixed stack: explicit zero is entered and still counts as entered', () => {
  const blank = breakEven({ guarantee: 250000, ticketPrice: 120 });
  const zero = breakEven({ guarantee: 250000, ticketPrice: 120, roomCost: 0 });
  assert.equal(zero.tickets, blank.tickets);
  assert.equal(Object.hasOwn(blank, 'fixedCosts'), false);
  assert.deepEqual(zero.fixedCosts.roomCost, { entered: true, value: 0 });
  assert.deepEqual(zero.fixedCosts.productionCost, { entered: false, value: null });
  assert.deepEqual(zero.fixedCosts.marketingCost, { entered: false, value: null });
  assert.deepEqual(zero.fixedCosts.otherFixedCosts, { entered: false, value: null });
  assert.deepEqual(zero.fixedCosts.sponsorOffset, { entered: false, value: null });
  assert.equal(zero.fixedCosts.totalToRecover, 250000);
});

test('fixed stack: entered costs add, an offset subtracts, ceil stays exact', () => {
  const room = breakEven({ guarantee: 250000, ticketPrice: 120, roomCost: 10000 });
  assert.equal(room.tickets, 2167);
  assert.equal(room.fixedCosts.totalToRecover, 260000);
  const stacked = breakEven({
    guarantee: 250000, ticketPrice: 120,
    roomCost: 10000, productionCost: 2000, marketingCost: 0, otherFixedCosts: 500, sponsorOffset: 120,
  });
  // 250000 + 10000 + 2000 + 0 + 500 - 120 = 262380; 262380 / 120 = 2186.5 -> 2187
  assert.equal(stacked.fixedCosts.totalToRecover, 262380);
  assert.equal(stacked.tickets, 2187);
  assert.deepEqual(stacked.fixedCosts.marketingCost, { entered: true, value: 0 });
  const offsetOnly = breakEven({ guarantee: 250000, ticketPrice: 120, sponsorOffset: 120 });
  assert.equal(offsetOnly.tickets, 2083);
  assert.equal(offsetOnly.fixedCosts.totalToRecover, 249880);
  const explicitOffsetZero = breakEven({ guarantee: 250000, ticketPrice: 120, sponsorOffset: 0 });
  assert.equal(explicitOffsetZero.tickets, 2084);
  assert.equal(explicitOffsetZero.fixedCosts.totalToRecover, 250000);
  assert.equal(explicitOffsetZero.fixedCosts.sponsorOffset.entered, true);
});

test('fixed stack: negatives, non-numbers, and a wiped total are refused', () => {
  assert.throws(() => breakEven({ guarantee: 250000, ticketPrice: 120, roomCost: -1 }), /venue cost must be >= 0/);
  assert.throws(() => breakEven({ guarantee: 250000, ticketPrice: 120, productionCost: Number.NaN }), /production cost must be >= 0/);
  assert.throws(() => breakEven({ guarantee: 250000, ticketPrice: 120, marketingCost: '2' }), /marketing cost must be >= 0/);
  assert.throws(() => breakEven({ guarantee: 1000, ticketPrice: 50, sponsorOffset: 1000 }), /total fixed must stay > 0/);
  assert.throws(() => breakEven({ guarantee: 0, ticketPrice: 120, roomCost: 0 }), /total fixed must stay > 0/);
  assert.throws(() => breakEven({ guarantee: 500, ticketPrice: 50, roomCost: 100, sponsorOffset: 600 }), /total fixed must stay > 0/);
});

test('fixed stack: guarantee 0 stays the old note only when every new field is blank', () => {
  const blank = breakEven({ guarantee: 0, ticketPrice: 120 });
  assert.deepEqual(blank, { tickets: 0, note: 'no guarantee', verdict: null, net: 120, capacity: null, variableCost: 0 });
  assert.equal(Object.hasOwn(blank, 'fixedCosts'), false);
  const withRoom = breakEven({ guarantee: 0, ticketPrice: 120, roomCost: 120 });
  assert.equal(withRoom.tickets, 1);
  assert.equal(withRoom.note, null);
  assert.equal(withRoom.fixedCosts.totalToRecover, 120);
});

test('fixed stack: capacity guard keeps its sentence', () => {
  const over = breakEven({ guarantee: 250000, ticketPrice: 120, roomCost: 10000, capacity: 100 });
  assert.equal(over.tickets, 2167);
  assert.equal(over.verdict, 'Cannot break even in this room at this guarantee');
});

test('fixed stack: pipeline blank path omits fixedCosts and stays 2,084', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  assert.equal(v.status, 'verdict');
  assert.equal(v.breakEven.tickets, 2084);
  assert.equal(v.breakEven.net, 120);
  assert.equal(Object.hasOwn(v.breakEven, 'fixedCosts'), false);
  assert.deepEqual(Object.keys(v.breakEven).sort(), ['net', 'note', 'price', 'tickets', 'variableCost', 'verdict']);
});

test('fixed stack: pipeline adds entered costs and refuses a wiped total before any live call', async () => {
  const v = await runVerdict(baseInput({ roomCost: 10000, productionCost: 0, sponsorOffset: 120 }), baseDeps());
  assert.equal(v.breakEven.tickets, 2166);
  assert.equal(v.breakEven.fixedCosts.totalToRecover, 259880);
  assert.equal(v.breakEven.fixedCosts.productionCost.entered, true);
  assert.equal(v.breakEven.fixedCosts.productionCost.value, 0);
  assert.equal(v.breakEven.fixedCosts.marketingCost.entered, false);
  await assert.rejects(
    () => runVerdict(baseInput({ roomCost: -1 }), baseDeps()),
    (err) => err.code === 'INVALID_INPUT' && /venue cost must be >= 0/.test(err.message),
  );
  await assert.rejects(
    () => runVerdict(baseInput({ guarantee: 1000, ticketPrice: 50, sponsorOffset: 1000 }), baseDeps()),
    (err) => err.code === 'INVALID_INPUT' && /total fixed must stay > 0/.test(err.message),
  );
});

test('fixed stack: workspace keeps a blank base hash-identical and treats an entered cost as a different offer', async () => {
  const blankVerdict = fixRestHashes(await runVerdict(baseInput(), baseDeps()));
  const blankWs = buildWorkspace(blankVerdict, baseInput());
  assert.equal(Object.hasOwn(blankWs.baseOffer, 'roomCost'), false);
  assert.equal(verifyWorkspace(blankWs).status, 'verified');
  assert.equal(blankWs.baseVerdict.tickets, 2084);

  const stackedVerdict = fixRestHashes(await runVerdict(baseInput({ roomCost: 12000 }), baseDeps()));
  const stackedWs = buildWorkspace(stackedVerdict, baseInput({ roomCost: 12000 }));
  assert.equal(stackedWs.baseOffer.roomCost, 12000);
  assert.equal(stackedWs.baseVerdict.tickets, 2184);
  assert.equal(verifyWorkspace(stackedWs).status, 'verified');
  assert.notEqual(computeWorkspaceId(blankWs.baseOffer, blankWs.baseVerdict.receipts), stackedWs.workspaceId);

  const same = {
    artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120, roomCost: 12000,
  };
  await assert.rejects(
    () => runComparison(stackedWs, { offers: [same] }, async () => baseDeps()),
    (err) => err.code === 'INVALID_INPUT' && /duplicate/.test(err.message),
  );
  const differed = await runComparison(stackedWs, {
    offers: [{ artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120 }],
  }, async () => baseDeps());
  assert.equal(differed.status, 'ok');
  const offerRow = differed.result.rows.find((row) => row.offerIndex === 1);
  assert.equal(offerRow.tickets, 2084);
  assert.equal(Object.hasOwn(offerRow, 'fixedCosts'), false);
  assert.equal(differed.result.rows[0].fixedCosts.totalToRecover, 262000);
  assert.doesNotMatch(JSON.stringify(differed), /winner|best/i);
});

function httpCall(port, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('fixed stack: REST refuses bad numbers before a missing key, and a valid stack still needs a key', { timeout: 30000 }, async () => {
  const env = { ...process.env };
  delete env.QLOO_API_KEY;
  delete env.TICKETMASTER_API_KEY;
  const { child, port } = await spawnEphemeralBackend(env);
  try {
    let health = null;
    for (let i = 0; i < 50; i += 1) {
      try {
        health = await httpCall(port, '/api/health');
        if (health.status === 200) break;
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(health.status, 200);
    const negative = await httpCall(port, '/api/verdict', 'POST', {
      artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120, roomCost: -1,
    });
    assert.equal(negative.status, 400);
    assert.match(negative.body, /venue cost must be >= 0/);
    const wiped = await httpCall(port, '/api/verdict', 'POST', {
      artist: 'Billie Eilish', city: 'New York', guarantee: 1000, ticketPrice: 50, sponsorOffset: 1000,
    });
    assert.equal(wiped.status, 400);
    assert.match(wiped.body, /total fixed must stay > 0/);
    const valid = await httpCall(port, '/api/verdict', 'POST', {
      artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120, roomCost: 10000,
    });
    assert.equal(valid.status, 503);
    assert.match(valid.body, /NOT_CONFIGURED/);
    const stream = await httpCall(port, '/api/verdict/stream?artist=Billie%20Eilish&city=New%20York&guarantee=250000&ticketPrice=120&marketingCost=-2');
    assert.match(stream.body, /marketing cost must be >= 0/);
  } finally {
    child.kill('SIGTERM');
  }
});

function mcpServer() {
  return createMcpServer({
    config: { qlooKeyConfigured: false, tmKeyConfigured: false },
    guards: new Guards(),
    receipts: new ReceiptStore(),
    mcpCall: async () => { throw new Error('live call is not used by break-even'); },
    restCall: async () => { throw new Error('live call is not used by break-even'); },
    llmConfigured: false,
  });
}

async function mcpCall(server, name, args) {
  const res = await server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return { isError: Boolean(res.result.isError), payload: JSON.parse(res.result.content[0].text) };
}

test('fixed stack: MCP schema stays at 33 tools and documents the optional fields', async () => {
  const defs = buildToolDefs();
  assert.equal(defs.length, 33);
  assert.equal(defs.filter((d) => d.name.startsWith('offersheet_')).length, 23);
  assert.equal(defs.filter((d) => d.name.startsWith('qloo_')).length, 10);
  for (const name of ['offersheet_deal_breakeven', 'offersheet_verdict_run', 'offersheet_verdict_race']) {
    const tool = defs.find((d) => d.name === name);
    assert.ok(tool, name);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(!tool.inputSchema.required.includes('roomCost'));
    for (const key of ['roomCost', 'productionCost', 'marketingCost', 'otherFixedCosts', 'sponsorOffset']) {
      const prop = tool.inputSchema.properties[key];
      assert.equal(prop.type, 'number', `${name}.${key}`);
      assert.equal(prop.minimum, 0, `${name}.${key}`);
      assert.match(prop.description, /Blank is not entered and is not zero/);
    }
    assert.match(tool.description, /blank/i);
  }
  const deal = defs.find((d) => d.name === 'offersheet_deal_breakeven');
  assert.match(deal.description, /total fixed/);
  assert.match(deal.description, /Cannot break even in this room at this guarantee/);

  const server = mcpServer();
  const blank = await mcpCall(server, 'offersheet_deal_breakeven', { guarantee: 250000, ticketPrice: 120 });
  assert.equal(blank.isError, false);
  assert.equal(blank.payload.tickets, 2084);
  assert.equal(Object.hasOwn(blank.payload, 'fixedCosts'), false);
  const stacked = await mcpCall(server, 'offersheet_deal_breakeven', { guarantee: 250000, ticketPrice: 120, roomCost: 10000 });
  assert.equal(stacked.payload.tickets, 2167);
  assert.equal(stacked.payload.fixedCosts.totalToRecover, 260000);
  const bad = await mcpCall(server, 'offersheet_deal_breakeven', { guarantee: 250000, ticketPrice: 120, roomCost: -1 });
  assert.equal(bad.isError, true);
  assert.equal(bad.payload.code, 'INVALID_INPUT');
  assert.match(bad.payload.message, /roomCost/);
});
