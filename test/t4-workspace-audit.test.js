// Workspace audit regressions (tech track, deal workspace + compare).
// Covers the residual defects found AFTER the two live-observed compare
// quirks were already closed in the working tree by the in-flight guard
// and the row-0 dedupe filter (see the companion report):
//   P1. comparison replay buttons keyed by filtered-array index, not by
//       offerIndex, so the first offer's replay resolved to the server
//       base row (no receipts, dead button) and every later offer's
//       replay replayed the previous offer's receipt;
//   P2. the compare handler's out/ref elements were captured before the
//       await, so a mid-flight re-render left a refusal written to a
//       detached node and invisible;
//   P3. import admitted any well-shaped JSON without server verification
//       (tampered base numbers / forged receipt hashes imported
//       silently) and without a steps-shape gate (a malformed steps
//       object could throw inside render and brick the panel);
//   P4. a comparison finishing after a mid-flight re-seed stored rows
//       priced against the old base onto the new workspace;
//   P5. locally computed settlements rendered identically to
//       server-verified ones (renegotiation/envelope already labelled
//       their local fallback; settlements did not).
// Fixtures are shape-only placeholders, never presented as a live run.
// The frontend is run in node:vm against a minimal DOM stub with real
// innerHTML-replacement semantics: setting innerHTML creates FRESH child
// element objects, so a reference captured before a re-render is detached
// afterwards, exactly as in a browser (this is what makes the P2
// detached-refusal test discriminate: the earlier stub style reused
// element objects, which masked the bug). The stub also keeps a
// replay-button registry (persistent button objects keyed by
// data-ws-replay value, as bindStatic re-scans on every render) and a
// FileReader stub for the import path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { breakEven } from '../backend/src/breakeven.js';
import { argsHashFor } from '../backend/src/receipts.js';
import { computeWorkspaceId } from '../backend/src/workspace.js';

const SORT_NOTE = 'Sorted by tickets needed to break even. This is not a ranking of which offer will succeed.';

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

function offerReceipt(claim, id, entity) {
  return {
    claim, operation: 'qloo_describe', requestHash: `hash-${id}`, requestId: `req-${id}`,
    resultCount: 1, ids: [id], entityIds: [id],
    replay: { kind: 'mcp', tool: 'qloo_describe', args: { entity, type: 'artist' } },
  };
}

// Backend-shaped comparison result: rows[0] is the server's own base row
// (offerIndex 0), exactly as backend/src/workspace.js returns it. Each
// offer row carries a distinct receipt so a shifted replay key is visible.
function comparePayload() {
  return {
    status: 'ok', step: 'comparison', workspaceId: 'test-id',
    result: {
      rows: [
        { offerIndex: 0, artist: 'Test Act', city: 'Test City', guarantee: 250000, tickets: 2084, capacity: { value: null, state: 'unknown' }, receipts: [], receiptCount: 1, status: 'verdict' },
        { offerIndex: 1, artist: 'Offer One', city: 'Offer City', guarantee: 100000, tickets: 834, capacity: { value: null, state: 'unknown' }, receipts: [offerReceipt('offer one claim', 'offer-one-id', 'Offer One')], status: 'verdict' },
        { offerIndex: 2, artist: 'Offer Two', city: 'Second City', guarantee: 50000, tickets: 417, capacity: { value: null, state: 'unknown' }, receipts: [offerReceipt('offer two claim', 'offer-two-id', 'Offer Two')], status: 'verdict' },
      ],
      sortNote: SORT_NOTE,
    },
    receipts: [], recordedAt: '2026-10-29T12:30:00.000Z',
  };
}

function seededComparisonWorkspace() {
  const ws = manualWorkspace();
  ws.steps.comparison = { result: comparePayload().result, recordedAt: '2026-10-29T12:30:00.000Z' };
  return ws;
}

const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

async function loadWorkspace(seed) {
  const src = await readFile(new URL('../frontend/workspace.js', import.meta.url).pathname, 'utf8');
  const elements = new Map();
  const replayRegistry = new Map();
  function submitButtonsFrom(html) {
    const btns = [];
    const re = /<button type="submit"([^>]*)>([\s\S]*?)<\/button>/g;
    let m;
    while ((m = re.exec(html))) {
      btns.push({ disabled: /disabled/.test(m[1]), textContent: m[2], dataset: {}, addEventListener() {} });
    }
    return btns;
  }
  function el(id) {
    if (!elements.has(id)) {
      const e = {
        id, _html: '', textContent: '', value: '', dataset: {}, disabled: false, files: null,
        _listeners: {}, _submitBtns: [],
        addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
        querySelectorAll(sel) { return sel === 'button[type="submit"]' ? this._submitBtns : []; },
      };
      Object.defineProperty(e, 'innerHTML', {
        get() { return this._html; },
        set(v) {
          this._html = String(v);
          // Fresh objects for every id in the new HTML: a pre-render
          // reference is detached afterwards, as in a real browser.
          for (const [, found] of this._html.matchAll(/id="([^"]+)"/g)) {
            elements.delete(found);
            el(found);
          }
          if (this.id === 'wsComparison') this._submitBtns = submitButtonsFrom(this._html);
        },
      });
      elements.set(id, e);
    }
    return elements.get(id);
  }
  const store = new Map([['offersheet-workspace-v1', JSON.stringify(seed)]]);
  const fetchCalls = [];
  const fetchQueue = [];
  const fetchStub = (url, opts) => {
    fetchCalls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return new Promise((resolve, reject) => fetchQueue.push({ resolve, reject }));
  };
  const sandbox = {
    document: {
      readyState: 'complete',
      getElementById: (id) => el(id),
      querySelectorAll: (sel) => {
        if (sel !== '[data-ws-replay]') return [];
        const out = [];
        for (const e of elements.values()) {
          for (const m of (e._html || '').matchAll(/data-ws-replay="([^"]+)"/g)) {
            const key = m[1];
            if (!replayRegistry.has(key)) {
              replayRegistry.set(key, {
                dataset: {}, _listeners: {},
                getAttribute: () => key,
                addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
              });
            }
            out.push(replayRegistry.get(key));
          }
        }
        return out;
      },
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ click() {}, dataset: {}, addEventListener() {}, href: '', download: '' }),
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    FileReader: class {
      constructor() { this.onload = null; this.result = null; }
      readAsText(f) { this.result = f.content; if (this.onload) this.onload(); }
    },
    fetch: fetchStub,
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const fire = (element, type) => {
    const fns = [...(element._listeners[type] || [])];
    return fns.map((fn) => fn({ preventDefault() {} }));
  };
  const settleFetch = (entry) => {
    const q = fetchQueue.shift();
    assert.ok(q, 'a fetch must be outstanding to settle');
    if (entry instanceof Error) q.reject(entry);
    else q.resolve(entry);
  };
  return {
    elements, store, fetchCalls,
    api: () => sandbox.OfferSheetWorkspace,
    panelHtml: () => elements.get('wsComparison').innerHTML,
    settleHtml: () => elements.get('wsSettlement').innerHTML,
    baseHtml: () => elements.get('wsBase').innerHTML,
    actionsOut: () => elements.get('wsActionsOut').textContent,
    form: () => elements.get('wsCompForm'),
    addBtn: () => elements.get('wsCompAddBtn'),
    submitBtn: () => elements.get('wsComparison')._submitBtns[0],
    replayButton: (key) => replayRegistry.get(key) || null,
    fire, tick,
    resolveFetch: (payload, opts = {}) => settleFetch({ status: opts.status ?? 200, ok: opts.ok ?? true, json: async () => payload }),
    rejectFetch: (err) => settleFetch(err instanceof Error ? err : new Error(err)),
    saved: () => JSON.parse(store.get('offersheet-workspace-v1')),
    importFile: async (obj) => {
      const imp = elements.get('wsImportFile');
      imp.files = [{ content: JSON.stringify(obj) }];
      fire(imp, 'change');
      await tick();
    },
  };
}

function fillOffer(h, i, artist, city, guarantee) {
  h.elements.get(`ws-comp-artist-${i}`).value = artist;
  h.elements.get(`ws-comp-city-${i}`).value = city;
  h.elements.get(`ws-comp-g-${i}`).value = String(guarantee);
  h.elements.get(`ws-comp-price-${i}`).value = '120';
  h.elements.get(`ws-comp-cost-${i}`).value = '';
  h.elements.get(`ws-comp-cap-${i}`).value = '';
  h.elements.get(`ws-comp-venue-${i}`).value = '';
}

test('P1: comparison replay buttons are keyed by offerIndex, never by filtered position', async () => {
  const h = await loadWorkspace(seededComparisonWorkspace());
  const html = h.panelHtml();
  assert.ok(html.includes('data-ws-replay="comp1|0"'), 'first offer replays under its offerIndex key comp1');
  assert.ok(html.includes('data-ws-replay="comp2|0"'), 'second offer replays under its offerIndex key comp2');
  assert.ok(!html.includes('data-ws-replay="comp0|'), 'no comp0 key may exist: the server base row is filtered out, so a comp0 key could only resolve to it');
});

test('P1: clicking the first offer replay replays that offer receipt, not the base row', async () => {
  const h = await loadWorkspace(seededComparisonWorkspace());
  // Identify the first offer's button from its own table row, not from
  // a guessed key: pre-fix, this row's key is comp0, which resolves to
  // the server base row (no receipts) and the click issues no request.
  const rowHtml = h.panelHtml().split('<tr>').find((s) => s.includes('Offer One'));
  assert.ok(rowHtml && rowHtml.includes('data-ws-replay="comp1|0"'), 'the first offer row carries the comp1 key');
  const btn = h.replayButton('comp1|0');
  assert.ok(btn, 'comp1 replay button exists');
  h.fire(btn, 'click');
  await h.tick(2);
  assert.equal(h.fetchCalls.length, 1, 'replay issues exactly one request');
  assert.equal(h.fetchCalls[0].url, '/api/replay', 'replay goes to the replay endpoint');
  assert.deepEqual(h.fetchCalls[0].body, { kind: 'mcp', tool: 'qloo_describe', args: { entity: 'Offer One', type: 'artist' } }, 'the replayed call is the first offer receipt, not the base row or the previous offer');
  h.resolveFetch({ ids: ['offer-one-id'], resultCount: 1 });
  await h.tick();
  assert.match(h.elements.get('ws-replay-comp1-0').textContent, /Replay match/, 'the replayed IDs match the first offer receipt');
});

test('P2: a comparison refusal after a mid-flight re-render is visible in the current panel', async () => {
  const h = await loadWorkspace(manualWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  const done = h.fire(h.form(), 'submit')[0];
  await h.tick(2);
  assert.equal(h.fetchCalls.length, 1, 'first submit starts one compare request');
  h.fire(h.addBtn(), 'click');
  await h.tick(2);
  h.resolveFetch(
    { status: 'step_refused', step: 'comparison', error: { code: 'INVALID_INPUT', message: 'offer run refused for test' }, detail: 'refused for test' },
    { status: 400, ok: false },
  );
  await done;
  await h.tick();
  // NOTE: the stub's parent innerHTML is a static string, so a refusal
  // written into the live refusal element is asserted on that element,
  // exactly as a browser would serialize it into the panel.
  assert.match(h.elements.get('wsCompRefusal').innerHTML, /Step refused/, 'the refusal is rendered in the current panel, not a detached node');
  assert.match(h.elements.get('wsCompRefusal').innerHTML, /INVALID_INPUT/, 'the refusal code is visible');
  assert.equal(h.submitBtn().textContent, 'Compare offers', 'the button restores once the comparison settles');
  assert.equal(h.fetchCalls.length, 1, 'no second request was started');
});

test('P2/P4 anchor: the in-flight guard still holds after the handler edits', async () => {
  const h = await loadWorkspace(manualWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  assert.equal(h.fetchCalls.length, 1, 'only the first submit may reach the server');
  h.resolveFetch(comparePayload());
  await h.tick();
  assert.ok(h.panelHtml().includes('<table'), 'the first flight still renders its table');
});

test('P3: import of a workspace with tampered base numbers is rejected and overwrites nothing', async () => {
  const h = await loadWorkspace(manualWorkspace());
  const tampered = manualWorkspace();
  tampered.baseVerdict.tickets = 100;
  const importing = h.importFile(tampered);
  await h.tick(2);
  assert.equal(h.fetchCalls.length, 1, 'import calls the verify endpoint');
  assert.equal(h.fetchCalls[0].url, '/api/workspace/verify', 'import verifies through the server endpoint');
  assert.deepEqual(h.fetchCalls[0].body.workspace.baseVerdict.tickets, 100, 'the submitted file, not the stored workspace, is what gets verified');
  h.resolveFetch({ status: 'verification_failed', mismatches: [{ field: 'baseVerdict.tickets', expected: 2084, submitted: 100 }] });
  await importing;
  await h.tick();
  assert.equal(h.saved().baseVerdict.tickets, 2084, 'the stored workspace is untouched by a rejected import');
  assert.match(h.actionsOut(), /Import rejected/, 'the rejection is reported');
  assert.match(h.actionsOut(), /Nothing was overwritten/, 'the rejection states nothing was overwritten');
});

test('P3: import of a verified workspace succeeds and stores the file', async () => {
  const h = await loadWorkspace(manualWorkspace());
  const incoming = manualWorkspace();
  incoming.baseOffer.artist = 'Incoming Act';
  const importing = h.importFile(incoming);
  await h.tick(2);
  h.resolveFetch({ status: 'verified', schemaOk: true, arithmeticOk: true, receiptHashesOk: true, mismatches: [] });
  await importing;
  await h.tick();
  assert.equal(h.saved().baseOffer.artist, 'Incoming Act', 'a verified import replaces the stored workspace');
  assert.equal(h.actionsOut(), 'Imported.', 'a verified import reports success');
});

test('P3: import with a malformed steps object is rejected before any verify call', async () => {
  const h = await loadWorkspace(manualWorkspace());
  const broken = manualWorkspace();
  broken.steps.comparison = { result: { rows: 'not-an-array' }, recordedAt: '2026-10-29T12:30:00.000Z' };
  await h.importFile(broken);
  assert.equal(h.fetchCalls.length, 0, 'a shape failure never reaches the server');
  assert.equal(h.saved().steps.comparison, null, 'the stored workspace is untouched');
  assert.match(h.actionsOut(), /Import rejected/, 'the rejection is reported');
});

test('P3: an edit-base workspace (no verdict, empty steps) imports without a verify call', async () => {
  const h = await loadWorkspace(manualWorkspace());
  const edited = {
    workspaceVersion: 1, workspaceId: 'edited-id',
    baseOffer: { artist: 'Edited Act', city: 'Edited City', venue: null, guarantee: 1000, ticketPrice: 50, variableCost: null, variableCostProvided: false, capacity: null, capacitySource: null },
    baseVerdict: null,
    steps: { replacements: [], renegotiation: null, routing: null, envelope: null, comparison: null, settlements: [] },
  };
  await h.importFile(edited);
  assert.equal(h.fetchCalls.length, 0, 'nothing numeric exists to recompute, so no verify call is needed');
  assert.equal(h.saved().baseOffer.artist, 'Edited Act', 'the edited workspace imports');
  assert.equal(h.saved().baseVerdict, null, 'the edited workspace keeps its null verdict');
});

test('P3: import refuses closed when the verify endpoint is unavailable', async () => {
  const h = await loadWorkspace(manualWorkspace());
  const incoming = manualWorkspace();
  const importing = h.importFile(incoming);
  await h.tick(2);
  h.resolveFetch({}, { status: 404, ok: false });
  await importing;
  await h.tick();
  assert.equal(h.saved().baseVerdict.tickets, 2084, 'an unverifiable import overwrites nothing');
  assert.match(h.actionsOut(), /Import rejected/, 'the refusal is reported');
});

test('P4: a comparison finishing after a mid-flight re-seed is discarded, not stored on the new base', async () => {
  const h = await loadWorkspace(manualWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  const done = h.fire(h.form(), 'submit')[0];
  await h.tick(2);
  assert.equal(h.fetchCalls.length, 1, 'compare request started against the original base');
  await h.api().seed({
    status: 'verdict', artist: 'New Act', city: 'New City', guarantee: 90000,
    breakEven: { tickets: 750, net: 120, price: { value: 120 }, variableCost: { provided: false } },
    capacity: { state: 'unknown' }, receipts: [], audience: { areas: [] },
    openers: { ranked: [], candidates: [], topPick: null }, missTrial: null,
  });
  await h.tick(2);
  assert.equal(h.saved().baseOffer.artist, 'New Act', 'the re-seed replaced the workspace mid-flight');
  h.resolveFetch(comparePayload());
  await done;
  await h.tick();
  assert.equal(h.saved().steps.comparison, null, 'the stale result was not stored on the new workspace');
  assert.equal(h.saved().baseOffer.artist, 'New Act', 'the new base is intact');
  assert.match(h.elements.get('wsCompOut').textContent, /discarded/, 'the discard is reported in the panel');
});

test('P5: a locally computed settlement is labelled local, unlike a server entry', async () => {
  const h = await loadWorkspace(manualWorkspace());
  h.elements.get('ws-settle-att').value = '3000';
  h.elements.get('ws-settle-cost').value = '';
  h.elements.get('ws-settle-note').value = '';
  h.fire(h.elements.get('wsSettleForm'), 'submit');
  await h.tick(2);
  assert.equal(h.fetchCalls.length, 1, 'settle posts to the server step');
  h.resolveFetch({}, { status: 404, ok: false });
  await h.tick();
  const html = h.settleHtml();
  assert.match(html, /3,000/, 'the reported attendance renders');
  assert.match(html, /916/, 'the gap against the recorded 2,084 renders');
  assert.match(html, /Computed locally from the recorded base/, 'the local fallback is labelled, as renegotiation and envelope already are');
});

test('P3: a replay mismatch flag does not survive an import of a different workspace', async () => {
  const h = await loadWorkspace(manualWorkspace());
  const baseBtn = h.replayButton('base|0');
  assert.ok(baseBtn, 'base replay button exists');
  h.fire(baseBtn, 'click');
  await h.tick(2);
  h.resolveFetch({ ids: ['changed-id'], resultCount: 1 });
  await h.tick();
  assert.match(h.baseHtml(), /replay mismatch/, 'the mismatch flag shows on the original workspace');
  const incoming = manualWorkspace();
  incoming.baseOffer.artist = 'Incoming Act';
  const importing = h.importFile(incoming);
  await h.tick(2);
  h.resolveFetch({ status: 'verified', schemaOk: true, arithmeticOk: true, receiptHashesOk: true, mismatches: [] });
  await importing;
  await h.tick();
  assert.doesNotMatch(h.baseHtml(), /replay mismatch/, 'importing a different workspace clears flags belonging to the old one');
});
