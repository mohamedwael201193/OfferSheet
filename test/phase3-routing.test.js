// Phase 3 Wave 1 — routing table why-not lines (F) + map-strip status (G).
// F: every non-top ranked candidate gains a one-line explanation computed
// ONLY from the routing result's own matched-area counts. No backend
// change was needed: runRouting already carries matchedAreasCount per
// ranked candidate (asserted below), so the frontend renders from it.
// The why-not line never mentions demand, sales, or attendance: matched
// areas are taste overlap only, per the existing routing disclosures.
// G (FAILED, documented here, not shipped as pins): no geography lookup
// is wired to the workspace panel. backend/src/osm.js exists for the
// verdict pipeline but has no HTTP endpoint and the frontend has no
// lookup path, so no pins are rendered and no coordinates are invented.
// The routing panel instead states the strip is unavailable; the table
// remains the full result. A follow-up (outside this worker's files)
// would need a same-origin geocode endpoint before pins can be honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { breakEven } from '../backend/src/breakeven.js';
import { argsHashFor } from '../backend/src/receipts.js';
import { computeWorkspaceId, runRouting } from '../backend/src/workspace.js';
import { baseDeps } from './fixtures.js';

// Hand-built workspace (same pattern as workspace.test.js manualWorkspace),
// base city Test City so no routing candidate collides with it.
function manualWorkspace() {
  const guarantee = 250000, ticketPrice = 120;
  const be = breakEven({ guarantee, ticketPrice, variableCost: 0, capacity: null });
  const args = { entity: 'Test Act', type: 'artist' };
  const receipts = [{
    claim: 'headliner description', operation: 'qloo_describe',
    requestHash: argsHashFor('qloo_describe', args), requestId: null, resultCount: 1,
    ids: ['test-entity-x'], entityIds: ['test-entity-x'],
    replay: { kind: 'mcp', tool: 'qloo_describe', args },
  }];
  const baseOffer = {
    artist: 'Test Act', city: 'Test City', venue: null, guarantee, ticketPrice,
    variableCost: null, variableCostProvided: false, capacity: null, capacitySource: null,
  };
  const baseVerdict = {
    tickets: be.tickets, net: be.net, verdict: be.verdict,
    capacityState: 'unknown', capacityCause: 'no_field',
    recordedAt: '2026-10-29T12:00:00.000Z', receipts,
    audience: { areas: [{ id: 'a1', name: 'Area One' }], areasCount: 1 },
    openers: { ranked: [], candidates: [], topPick: null },
    missTrial: null,
  };
  return {
    workspaceVersion: 1, workspaceId: computeWorkspaceId(baseOffer, receipts),
    baseOffer, baseVerdict,
    steps: { replacements: [], renegotiation: null, routing: null, envelope: null, comparison: null, settlements: [] },
  };
}

function routeReceipt(city, count) {
  const args = { entity: 'test-entity-x', within: city, limit: 10 };
  return {
    claim: `where the headliner is popular in ${city}`, operation: 'qloo_where_popular',
    requestHash: argsHashFor('qloo_where_popular', args), requestId: null, resultCount: count,
    ids: [], entityIds: [],
    replay: { kind: 'mcp', tool: 'qloo_where_popular', args },
  };
}

// Render frontend/workspace.js in a minimal DOM stub and return the
// stub elements by id. The seeded workspace is DERIVED test data (the
// shape of a real routing result), never a live run.
async function renderWorkspaceElements(candidates) {
  const src = await readFile(new URL('../frontend/workspace.js', import.meta.url).pathname, 'utf8');
  const ws = manualWorkspace();
  ws.steps.routing = { result: { candidates }, recordedAt: '2026-10-29T12:00:00.000Z' };
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        innerHTML: '', textContent: '', value: '', dataset: {},
        addEventListener() {}, querySelectorAll() { return []; }, files: null,
      });
    }
    return elements.get(id);
  };
  const store = new Map([['offersheet-workspace-v1', JSON.stringify(ws)]]);
  const sandbox = {
    document: {
      readyState: 'complete',
      getElementById: (id) => el(id),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({}),
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return elements;
}

async function renderRoutingPanel(candidates) {
  return (await renderWorkspaceElements(candidates)).get('wsRouting').innerHTML;
}

function whyNotCells(html) {
  return [...html.matchAll(/<td class="ws-why-not">(.*?)<\/td>/g)].map((m) => m[1]);
}

test('phase3 F backend: routing result already carries matched-area counts per ranked candidate', async () => {
  const ws = manualWorkspace();
  const deps = baseDeps();
  deps.mcpCall = async (tool, args) => {
    assert.equal(tool, 'qloo_where_popular');
    if (args.within === 'Los Angeles') return { status: 'ok', results: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
    if (args.within === 'Chicago') return { status: 'ok', results: [{ name: 'A' }, { name: 'B' }] };
    if (args.within === 'Boston') return { status: 'ok', results: [{ name: 'A' }, { name: 'B' }] };
    if (args.within === 'Nowhere') return { status: 'empty', results: [] };
    throw new Error(`unexpected city ${args.within}`);
  };
  const out = await runRouting(ws, { candidateCities: ['Chicago', 'Boston', 'Los Angeles', 'Nowhere'] }, deps);
  assert.equal(out.status, 'ok');
  const rows = out.result.candidates;
  // No backend change was needed for F: these fields already exist.
  assert.equal(rows[0].city, 'Los Angeles');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].matchedAreasCount, 3);
  assert.equal(rows[1].matchedAreasCount, 2);
  assert.equal(rows[2].matchedAreasCount, 2);
  assert.equal(rows[3].rank, null);
});

test('phase3 F frontend: why-not lines equal the routing result counts, with a labelled omission when counts are absent', async () => {
  const candidates = [
    { city: 'Los Angeles', rank: 1, status: 'ok', matchedAreasCount: 3, areas: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], receipts: [routeReceipt('Los Angeles', 3)] },
    { city: 'San Francisco', rank: 2, status: 'ok', matchedAreasCount: 3, areas: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], receipts: [routeReceipt('San Francisco', 3)] },
    { city: 'Chicago', rank: 3, status: 'ok', matchedAreasCount: 2, areas: [{ name: 'A' }, { name: 'B' }], receipts: [routeReceipt('Chicago', 2)] },
    // Count deliberately absent: the line must be an omission label, never prose.
    { city: 'Austin', rank: 4, status: 'ok', areas: [{ name: 'A' }], receipts: [routeReceipt('Austin', 1)] },
    { city: 'Nowhere', rank: null, status: 'empty', reason: 'no data for this entity/region' },
  ];
  const html = await renderRoutingPanel(candidates);
  assert.ok(html.includes('Why not first'), 'routing table gains a Why not first column');
  const cells = whyNotCells(html);
  assert.equal(cells.length, 5, 'one why-not cell per table row');
  assert.equal(cells[0], 'Ranked first.');
  // Tie with the top: same count, ranked below by Qloo return order.
  assert.equal(cells[1], 'Why not ranked first: 3 matched areas — the same count as Los Angeles, ranked below it by Qloo return order.');
  // Fewer: both numbers in the line equal the routing result fields.
  assert.equal(cells[2], 'Why not ranked first: 2 matched areas vs 3 for Los Angeles — fewer matched areas.');
  // Absent count: labelled omission, no invented number.
  assert.equal(cells[3], 'Why not ranked first: omitted — matched-area count not present in the routing result.');
  assert.equal(cells[4], '—');
  for (const cell of cells) {
    assert.ok(!/demand|sales|attendance/i.test(cell), `why-not line must not mention demand, sales, or attendance: ${cell}`);
  }
});

test('phase3 S6: workspace header frames the existing steps as a season ledger (copy only)', async () => {
  const candidates = [
    { city: 'Los Angeles', rank: 1, status: 'ok', matchedAreasCount: 3, areas: [{ name: 'A' }], receipts: [routeReceipt('Los Angeles', 3)] },
    { city: 'Chicago', rank: 2, status: 'ok', matchedAreasCount: 2, areas: [{ name: 'A' }], receipts: [routeReceipt('Chicago', 2)] },
  ];
  const elements = await renderWorkspaceElements(candidates);
  const header = elements.get('wsHeader').innerHTML;
  assert.ok(header.includes('Season ledger: offers, routing, then settlement — the same workspace, read as a season, using only the steps already here.'),
    'workspace header carries the season-ledger framing line');
  // Copy only: the framing adds no new step, number, or feature — the
  // routing table below it is unchanged by the framing.
  assert.ok(elements.get('wsRouting').innerHTML.includes('Why not ranked first: 2 matched areas vs 3 for Los Angeles'),
    'routing table renders unchanged alongside the framing');
});

test('phase3 G (SHIPPED): routing panel renders a cities-only map strip container', async () => {
  const candidates = [
    { city: 'Los Angeles', rank: 1, status: 'ok', matchedAreasCount: 3, areas: [{ name: 'A' }], receipts: [routeReceipt('Los Angeles', 3)] },
    { city: 'Chicago', rank: 2, status: 'ok', matchedAreasCount: 2, areas: [{ name: 'A' }], receipts: [routeReceipt('Chicago', 2)] },
  ];
  const html = await renderRoutingPanel(candidates);
  assert.ok(html.includes('id="wsMapStrip"'), 'the panel renders the map strip container above the table');
  assert.ok(!html.includes('Map strip unavailable — no geography lookup is wired'), 'the old unwired note is gone');
  const src = await readFile(new URL('../frontend/workspace.js', import.meta.url).pathname, 'utf8');
  assert.ok(src.includes("'/api/workspace/geocode'"), 'workspace.js calls the server geocode endpoint');
  assert.ok(src.includes('push(ws.baseOffer.city)'), 'strip cities start from the base city');
  assert.ok(src.includes('p.lat.toFixed(4)') && src.includes('p.lon.toFixed(4)'), 'strip coordinates come from geocoded pins, never hardcoded');
});
