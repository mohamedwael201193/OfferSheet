// Q2 — workspace compare quirks regressions (behaviour-only, no browser).
//
// What this file covers, against frontend/workspace.js run in node:vm
// behind a minimal DOM stub:
//   (a) NO DUPLICATE ROW: invoking compare twice in a row — a second
//       submit while a comparison is working, a mid-flight re-render
//       followed by a second submit, and two sequential successful
//       compares — can never produce a duplicate row "0", and a saved
//       server result that itself repeats a row renders each row once.
//   (b) NO STUCK "Working…": the compare control always reaches a terminal
//       state — button re-enabled and label restored — on success, on a
//       network failure, on a refused step, and on an unavailable endpoint,
//       and a fresh submit works again after any settle.
// What this file does NOT cover:
//   Browser rendering, live verdicts, real devices, the server's own
//   comparison arithmetic, or the network itself (fetch is stubbed).
//   Fixtures below are shape-only placeholders, never a live run.
//
// Deliberate choices:
//   - Behaviour-only: no assertion names any internal guard variable, so
//     a refactor that renames the guard but keeps the behaviour still
//     passes. A guard that only disables the button (and is discarded by
//     a re-render) fails test 2 by sending a second request.
//   - Stub fidelity: the stub implements the one real-DOM behaviour that
//     matters here — setting innerHTML replaces the elements, so listeners
//     do not accumulate across renders. One stub limitation is documented
//     where it bites: element identity survives a render in the stub (the
//     real DOM creates new elements), so these tests never assert that
//     output text was cleared by a render; they assert button state and
//     table HTML, both of which are re-derived from innerHTML on render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SORT_NOTE = 'Sorted by tickets needed to break even. This is not a ranking of which offer will succeed.';

// Shape-only fixture workspace: a seeded base verdict plus empty steps.
// Tickets 2,084 are arithmetic placeholders for the fixture terms, not a
// live run and not presented as one.
function fixtureWorkspace() {
  const receipts = [{
    claim: 'headliner description', operation: 'qloo_describe',
    requestHash: 'q2-fixture-hash', requestId: null, resultCount: 1,
    ids: ['test-entity-x'], entityIds: ['test-entity-x'],
    replay: { kind: 'mcp', tool: 'qloo_describe', args: { entity: 'Test Act', type: 'artist' } },
  }];
  return {
    workspaceVersion: 1, workspaceId: 'q2-fixture-id',
    baseOffer: {
      artist: 'Test Act', city: 'Test City', venue: null, guarantee: 250000,
      ticketPrice: 120, variableCost: null, variableCostProvided: false,
      capacity: null, capacitySource: null,
    },
    baseVerdict: {
      tickets: 2084, net: 120, verdict: 'fixture verdict',
      capacityState: 'unknown', capacityCause: 'no_field',
      recordedAt: '2026-10-29T12:00:00.000Z', receipts,
      audience: { areas: [{ id: 'a1', name: 'Area One' }], areasCount: 1 },
      openers: { ranked: [], candidates: [], topPick: null },
      missTrial: null,
    },
    steps: { replacements: [], renegotiation: null, routing: null, envelope: null, comparison: null, settlements: [] },
  };
}

// Backend-shaped comparison result: rows[0] is the server's own base row
// (offerIndex 0). The duplicated rows below are the regression input: a
// server result that repeats offerIndex 1 and repeats the base row must
// still render each row exactly once.
function comparePayload() {
  const baseRow = {
    offerIndex: 0, artist: 'Test Act', city: 'Test City', guarantee: 250000,
    tickets: 2084, capacity: { value: null, state: 'unknown' }, receipts: [],
    receiptCount: 1, status: 'verdict',
  };
  const row1 = {
    offerIndex: 1, artist: 'Offer Act', city: 'Offer City', guarantee: 100000,
    tickets: 834, capacity: { value: null, state: 'unknown' },
    receipts: [{ claim: 'offer claim', operation: 'qloo_describe', requestId: 'req-1', resultCount: 1, replay: null }],
    status: 'verdict',
  };
  const row2 = {
    offerIndex: 2, artist: 'Second Act', city: 'Second City', guarantee: 50000,
    tickets: 417, capacity: { value: null, state: 'unknown' }, receipts: [], status: 'verdict',
  };
  return {
    status: 'ok', step: 'comparison', workspaceId: 'q2-fixture-id',
    result: { rows: [baseRow, row1, { ...row1 }, baseRow, row2], sortNote: SORT_NOTE },
    receipts: [], recordedAt: '2026-10-29T12:30:00.000Z',
  };
}

const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

async function loadWorkspace(seed) {
  const src = await readFile(new URL('../frontend/workspace.js', import.meta.url).pathname, 'utf8');
  const elements = new Map();
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
          for (const [, found] of this._html.matchAll(/id="([^"]+)"/g)) {
            const child = el(found);
            child._listeners = {}; child.dataset = {};
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
  const pending = [];
  const fetchStub = (url, opts) => {
    fetchCalls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  const sandbox = {
    document: {
      readyState: 'complete',
      getElementById: (id) => el(id),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ click() {}, dataset: {}, addEventListener() {} }),
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
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
  const okResponse = (payload) => ({ status: 200, ok: true, json: async () => payload });
  return {
    elements, store, fetchCalls,
    compareCalls: () => fetchCalls.filter((c) => String(c.url).includes('/api/workspace/compare')),
    panelHtml: () => elements.get('wsComparison').innerHTML,
    submitBtn: () => elements.get('wsComparison')._submitBtns[0],
    form: () => elements.get('wsCompForm'),
    addBtn: () => elements.get('wsCompAddBtn'),
    outText: () => (elements.get('wsCompOut') || {}).textContent || '',
    fire, tick,
    resolveFetch: (payload) => {
      const p = pending.shift();
      assert.ok(p, 'a fetch must be outstanding to resolve');
      p.resolve(okResponse(payload));
    },
    resolveFetchStatus: (status, ok, payload) => {
      const p = pending.shift();
      assert.ok(p, 'a fetch must be outstanding to resolve');
      p.resolve({ status, ok, json: async () => payload });
    },
    rejectFetch: (err) => {
      const p = pending.shift();
      assert.ok(p, 'a fetch must be outstanding to reject');
      p.reject(err);
    },
    saved: () => JSON.parse(store.get('offersheet-workspace-v1')),
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

function countCell(html, n) {
  return (html.match(new RegExp(`<td>${n}<\\/td>`, 'g')) || []).length;
}
function countBaseRow(html) {
  return (html.match(/<td>0 \(base/g) || []).length;
}

test('compare: a saved result that repeats rows renders each row exactly once', async () => {
  const ws = fixtureWorkspace();
  ws.steps.comparison = { result: comparePayload().result, recordedAt: '2026-10-29T12:30:00.000Z' };
  const h = await loadWorkspace(ws);
  const html = h.panelHtml();
  assert.ok(html.includes('<table'), 'the saved comparison table must render');
  assert.equal(countBaseRow(html), 1, 'exactly one verified-base row 0');
  assert.equal(countCell(html, 0), 0, 'the server base row must not render a second row 0');
  assert.equal(countCell(html, 1), 1, 'a repeated server row 1 must render once, not twice');
  assert.equal(countCell(html, 2), 1, 'exactly one comparison row 2');
  assert.ok(html.includes(SORT_NOTE), 'the footer note stays');
});

test('compare: a second submit while working sends no second request and the first flight still renders one row per offer', async () => {
  const h = await loadWorkspace(fixtureWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  assert.equal(h.compareCalls().length, 1, 'first submit starts one compare request');
  assert.equal(h.submitBtn().disabled, true, 'button disabled while working');
  assert.equal(h.submitBtn().textContent, 'Working…', 'button shows Working… while working');
  h.fire(h.form(), 'submit');
  await h.tick(2);
  assert.equal(h.compareCalls().length, 1, 'the second submit while working must not start a second request');
  h.resolveFetch(comparePayload());
  await h.tick();
  const html = h.panelHtml();
  assert.ok(html.includes('<table'), 'the table renders in the same session — no reload');
  assert.equal(countBaseRow(html), 1, 'exactly one verified-base row 0');
  assert.equal(countCell(html, 0), 0, 'no duplicate row 0');
  assert.equal(countCell(html, 1), 1, 'exactly one comparison row 1');
  assert.equal(h.submitBtn().disabled, false, 'button re-enables once the comparison settles');
  assert.equal(h.submitBtn().textContent, 'Compare offers', 'button label restores once the comparison settles');
});

test('compare: a mid-flight re-render cannot re-enable the button, and a fresh submit works after the first flight settles', async () => {
  const h = await loadWorkspace(fixtureWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  h.fire(h.addBtn(), 'click');
  assert.equal(h.submitBtn().disabled, true, 'a mid-flight re-render must not re-enable Compare');
  assert.equal(h.submitBtn().textContent, 'Working…', 'a mid-flight re-render must not clear the Working… state');
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  fillOffer(h, 1, 'Second Act', 'Second City', 50000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  assert.equal(h.compareCalls().length, 1, 'the mid-flight second submit must not start a second request');
  h.resolveFetch(comparePayload());
  await h.tick();
  assert.equal(h.submitBtn().disabled, false, 'button re-enables after the first flight settles');
  // The guard must clear, not stick: a fresh submit after settling is a
  // new comparison, not a duplicate, and must reach the server once.
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  fillOffer(h, 1, 'Second Act', 'Second City', 50000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  assert.equal(h.compareCalls().length, 2, 'a fresh submit after settling must start exactly one new request');
  h.resolveFetch(comparePayload());
  await h.tick();
  assert.equal(countBaseRow(h.panelHtml()), 1, 'the second settled comparison still shows exactly one base row');
  assert.equal(countCell(h.panelHtml(), 0), 0, 'no duplicate row 0 after the second comparison');
});

test('compare: two sequential successful compares replace, never append, the table', async () => {
  const h = await loadWorkspace(fixtureWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  h.resolveFetch(comparePayload());
  await h.tick();
  assert.equal(h.panelHtml().match(/<table/g).length, 1, 'one table after the first comparison');
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  assert.equal(h.compareCalls().length, 2, 'the second comparison sends its own single request');
  h.resolveFetch(comparePayload());
  await h.tick();
  const html = h.panelHtml();
  assert.equal(html.match(/<table/g).length, 1, 'still one table after the second comparison, not two');
  assert.equal(countBaseRow(html), 1, 'exactly one base row after two sequential compares');
  assert.equal(countCell(html, 0), 0, 'no duplicate row 0 after two sequential compares');
});

test('compare: a network failure reaches a terminal state and a retry works', async () => {
  const h = await loadWorkspace(fixtureWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  assert.equal(h.submitBtn().textContent, 'Working…', 'button shows Working… while working');
  h.rejectFetch(new Error('network down'));
  await h.tick();
  assert.equal(h.submitBtn().disabled, false, 'button must re-enable after a network failure, never stick on Working…');
  assert.equal(h.submitBtn().textContent, 'Compare offers', 'button label must restore after a network failure');
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  assert.equal(h.compareCalls().length, 2, 'a retry after failure must start exactly one new request');
  h.resolveFetch(comparePayload());
  await h.tick();
  assert.ok(h.panelHtml().includes('<table'), 'the retry renders its table');
  assert.equal(countBaseRow(h.panelHtml()), 1, 'exactly one base row after the retry');
});

test('compare: a refused step reaches a terminal state', async () => {
  const h = await loadWorkspace(fixtureWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  h.resolveFetchStatus(400, false, {
    status: 'step_refused', error: { code: 'Q2_FIXTURE_REFUSAL', message: 'fixture refusal' }, detail: 'fixture',
  });
  await h.tick();
  assert.equal(h.submitBtn().disabled, false, 'button must re-enable after a refused step');
  assert.equal(h.submitBtn().textContent, 'Compare offers', 'button label must restore after a refused step');
  assert.equal(h.compareCalls().length, 1, 'the refused flight sent exactly one request');
  assert.ok(!h.panelHtml().includes('<table'), 'a refused step must not render a table');
});

test('compare: an unavailable endpoint reaches a terminal state', async () => {
  const h = await loadWorkspace(fixtureWorkspace());
  fillOffer(h, 0, 'Offer Act', 'Offer City', 100000);
  h.fire(h.form(), 'submit');
  await h.tick(2);
  h.resolveFetchStatus(404, false, null);
  await h.tick();
  assert.equal(h.submitBtn().disabled, false, 'button must re-enable when the endpoint is unavailable');
  assert.equal(h.submitBtn().textContent, 'Compare offers', 'button label must restore when the endpoint is unavailable');
});
