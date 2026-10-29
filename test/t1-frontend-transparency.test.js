// T1 (provenance) — frontend-only, same vm-slice pattern as the other
// frontend tests: slice app.js up to submitVerdict, run against a minimal
// fake document. Covers: REST step-log leg status, the pure replay
// comparison text (not-comparable transparency, match/mismatch verbatim),
// and proof-pack server-taxonomy preference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'app.js'), 'utf8');
const SLICE = APP_JS.slice(0, APP_JS.indexOf('async function submitVerdict'));

function makeEl(id) {
  const el = {
    id, hidden: false, textContent: '', className: '', value: '', dataset: {},
    open: false, ontoggle: null, onclick: null, style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    scrollIntoView() {}, focus() {}, addEventListener() {},
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ''; },
  };
  return el;
}

function loadApp() {
  const els = new Map();
  const doc = {
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement(tag) { const el = makeEl(tag); el.tagName = tag; return el; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  const sandbox = {
    document: doc,
    window: { matchMedia: () => ({ matches: true }), print: () => {} },
    navigator: {},
    console,
    setTimeout: (fn) => {},
  };
  sandbox.window.document = doc;
  vm.createContext(sandbox);
  vm.runInContext(SLICE, sandbox);
  return { sandbox, get: (id) => doc.getElementById(id) };
}

test('T1: step log shows the real leg status for REST receipts', () => {
  const { sandbox } = loadApp();
  const hash = 'a'.repeat(64);
  const restReceipt = {
    operation: 'rest:/search', requestHash: hash, requestId: null, resultCount: 2,
    replay: { kind: 'rest', path: '/search', params: { query: 'jazz', take: 5 } },
  };
  const withLeg = sandbox.stepLogHtml(restReceipt, { legs: { restSearch: { status: 'ok' } } });
  assert.match(withLeg, /leg ok/);
  assert.match(withLeg, new RegExp(`hash ${'a'.repeat(12)}`));
  assert.match(withLeg, /requestId —/);
  const withoutLeg = sandbox.stepLogHtml(restReceipt, { legs: {} });
  assert.match(withoutLeg, /receipted \(no leg status recorded\)/);
});

test('T1: not-comparable text gains status, timestamps, and call-hash — never a match claim', () => {
  const { sandbox } = loadApp();
  const base = {
    originalIds: null, replayedIds: [], count: 9, recordedCount: 9,
    replayStatus: 'ok', recordedAt: '2026-10-29T00:00:00.000Z',
    replayedAt: '2026-10-29T00:01:00.000Z', callHashMatch: true,
  };
  const text = sandbox.formatReplayComparisonText(base);
  assert.match(text, /not comparable/);
  assert.match(text, /Counts alone never prove a match/);
  assert.match(text, /Replay status: ok/);
  assert.match(text, /original recorded 2026-10-29T00:00:00\.000Z/);
  assert.match(text, /replayed 2026-10-29T00:01:00\.000Z/);
  assert.match(text, /same request hash/);
  assert.match(text, /result equality is still not comparable/);
  assert.doesNotMatch(text, /Replay match:/);

  const differing = sandbox.formatReplayComparisonText({ ...base, callHashMatch: false });
  assert.match(differing, /differs from the recorded hash/);

  const bare = sandbox.formatReplayComparisonText({
    originalIds: ['x'], replayedIds: null, count: null, recordedCount: null,
    replayStatus: null, recordedAt: null, replayedAt: null, callHashMatch: null,
  });
  assert.match(bare, /the replay did not return an ID list — not comparable/);
  assert.doesNotMatch(bare, /Replay status:/);
  assert.doesNotMatch(bare, /original recorded/);
  assert.doesNotMatch(bare, /same request hash/);
});

test('T1: match and mismatch strings are unchanged verbatim', () => {
  const { sandbox } = loadApp();
  assert.equal(
    sandbox.formatReplayComparisonText({ originalIds: ['a', 'b'], replayedIds: ['a', 'b'], count: 2, recordedCount: 2 }),
    'Replay match: live re-run returned the same IDs in the same order (2 results).',
  );
  assert.equal(
    sandbox.formatReplayComparisonText({ originalIds: ['a', 'b'], replayedIds: ['a', 'c'], count: 2, recordedCount: 2 }),
    'Replay mismatch: count matches but order/IDs differ — live data changed between runs. The receipt is the record of the original run. (Replay result count: 2; receipt recorded: 2.)',
  );
  assert.equal(
    sandbox.formatReplayComparisonText({ originalIds: ['a', 'b'], replayedIds: ['a'], count: 1, recordedCount: 2 }),
    'Replay mismatch: live re-run returned 1 results, but the receipt recorded 2. Live data changed between runs — the receipt is the record of the original run.',
  );
});

function syntheticVerdict(missTrial) {
  return {
    artist: 'Artist', city: 'City', guarantee: 250000,
    breakEven: { tickets: 2084, net: 120, price: { value: 120, source: 'user-supplied' }, variableCost: { value: null, provided: false } },
    openers: { topPick: 'Pick', ranked: [], candidates: [] },
    receipts: [], legs: {}, missTrial,
  };
}

test('T1: proof pack prefers server taxonomy when present, mirrors otherwise', () => {
  const { sandbox } = loadApp();
  const server = syntheticVerdict({
    misses: [{ arm: 'gut', pick: 'X', graphPick: 'Pick', code: 'NOT_IN_RANKED', label: 'pick is in the candidate set but not the ranked set', detail: 'server-coded' }],
    taxonomy: { counts: { NOT_IN_RANKED: 1 }, total: 1 },
  });
  const packServer = sandbox.buildProofPackObject(server);
  assert.equal(packServer.missLedger[0].code, 'NOT_IN_RANKED');
  assert.equal(packServer.missTaxonomy.total, 1);

  // No server taxonomy: empty ranked/candidate sets leave the mirror with
  // no derivable reason, so the miss stays UNCLASSIFIED — never guessed.
  const fallback = syntheticVerdict({ misses: [{ arm: 'gut', pick: 'X', graphPick: 'Pick' }] });
  const packFallback = sandbox.buildProofPackObject(fallback);
  assert.equal(packFallback.missLedger[0].code, 'UNCLASSIFIED');
});
