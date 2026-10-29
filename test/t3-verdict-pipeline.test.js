// T3 (verdict pipeline + legs + formula): frontend slice tests for the
// T3 patches only. Pattern: slice app.js up to submitVerdict, run in
// node:vm against a minimal fake document — exactly like
// test/ship-items.test.js. No live keys, no new calls; every fixture is
// a derived test input, never a recorded run.
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
    open: false, ontoggle: null, onclick: null, style: {}, _removed: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    scrollIntoView() {}, focus() {}, addEventListener() {},
    remove() { this._removed = true; },
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

function verdictFixture(overrides = {}) {
  const base = {
    artist: 'Billie Eilish', city: 'New York', guarantee: 250000,
    breakEven: { tickets: 2084, net: 120, price: { value: 120, source: 'user-supplied' }, variableCost: { value: null, provided: false } },
    capacity: { state: 'unknown', message: 'Venue capacity unknown — break-even is shown as tickets needed, not as a sellout percentage.' },
    audience: { note: 'Qloo returns matched areas/entities, not a headcount.', areas: [{ name: 'New York' }] },
    openers: { ranked: [{ name: 'Olivia Rodrigo' }], candidates: [{ name: 'Olivia Rodrigo' }, { name: 'Clairo' }], topPick: 'Olivia Rodrigo' },
    demographics: [{ band: '18-24' }],
    trends: null, sharedTags: ['Cod Fish'], overlap: null,
    arms: {
      gut: { arm: 'gut', status: 'ok', pick: 'Clairo' },
      web: { arm: 'web', status: 'ok', pick: 'Armani White' },
      graph: { arm: 'graph', status: 'ok', pick: 'Olivia Rodrigo' },
    },
    missTrial: { misses: [{ arm: 'gut', pick: 'Clairo', graphPick: 'Olivia Rodrigo' }] },
    ticketmaster: { status: 'ok', venueName: 'Madison Square Garden' },
    osm: { status: 'ok', displayName: 'New York', scope: 'display-only' },
    wikidata: { status: 'ok', scope: 'input to the Web arm only' },
    legs: {
      findTags: { status: 'ok' }, describe: { status: 'ok' }, recommend: { status: 'ok' },
      rank: { status: 'ok' }, wherePopular: { status: 'ok' }, demographics: { status: 'ok' },
      entityTags: { status: 'ok' }, trends: { status: 'empty', reason: 'no data' },
      compare: { status: 'empty', reason: 'no data' },
      restSearch: { status: 'ok', entities: [{ id: 'e0', name: 'Billie Eilish' }] },
      restInsights: { status: 'ok', entities: [{ id: 'e1', name: 'E1' }, { id: 'e2', name: 'E2' }] },
      restCompare: { status: 'ok', comparison: { overlap: 'test-comparison-object', shared: ['test-tag'] } },
      restEntities: { status: 'ok', entities: [{ id: 'e1', name: 'E1' }] },
    },
    receipts: [
      { claim: 'Graph rank for this city', operation: 'qloo_rank', requestId: 'req-1', resultCount: 3, ids: ['a', 'b'] },
    ],
    timingMs: 35319,
  };
  return { ...base, ...overrides };
}

// T3-P2: REST payloads surface on the leg row (no new call).
test('T3 leg rows surface fetched insights entities and the compare body', () => {
  const { sandbox } = loadApp();
  const insights = sandbox.legRowHtml('restInsights', { status: 'ok', entities: [{ id: 'e1', name: 'E1' }, { id: 'e2', name: 'E2' }] });
  assert.match(insights, /2 entities: E1, E2/);
  const compare = sandbox.legRowHtml('restCompare', { status: 'ok', comparison: { overlap: 'test-comparison-object', shared: ['test-tag'] } });
  assert.match(compare, /headliner-vs-opener audience comparison \(REST\)/);
  assert.match(compare, /test-comparison-object/);
  const entities = sandbox.legRowHtml('restEntities', { status: 'ok', entities: [{ id: 'e1', name: 'E1' }] });
  assert.match(entities, /entity details \(REST\)/);
  assert.match(entities, /1 entity: E1/);
  // An ok leg with an empty fetched list says so, instead of looking data-less.
  assert.match(sandbox.legRowHtml('restInsights', { status: 'ok', entities: [] }), /no entities returned/);
  // Payload rendering never invents HTML: names are escaped.
  assert.doesNotMatch(sandbox.legRowHtml('restInsights', { status: 'ok', entities: [{ name: '<script>' }] }), /<script>/);
});

// T3-P2: REST step-log lines carry their leg status and parameters.
test('T3 step log maps REST operations to legs and shows REST params', () => {
  const { sandbox } = loadApp();
  const v = verdictFixture();
  const receipt = {
    operation: 'rest:/v2/insights', requestHash: 'h-insights', requestId: null, resultCount: 2,
    replay: { kind: 'rest', path: '/v2/insights', params: { 'filter.type': 'urn:entity:artist', 'signal.interests.tags': 'urn:tag:x' } },
  };
  const html = sandbox.stepLogHtml(receipt, v);
  assert.match(html, /leg ok/);
  assert.doesNotMatch(html, /no leg status recorded/);
  assert.match(html, /urn:entity:artist/);
});

// T3-P1: the cannot-break-even verdict travels with the sheet and brief.
test('T3 sheet and brief carry the cannot-break-even line when over capacity', () => {
  const { sandbox, get } = loadApp();
  const impossible = verdictFixture({
    capacity: { state: 'known', value: 1000, source: 'user-supplied, not Ticketmaster-verified' },
    breakEven: { tickets: 2084, net: 120, verdict: 'Cannot break even in this room at this guarantee', price: { value: 120, source: 'user-supplied' }, variableCost: { value: null, provided: false } },
  });
  sandbox.renderVerdict(impossible, false);
  assert.match(get('sheetBody').innerHTML, /Cannot break even in this room at this guarantee/);
  const brief = sandbox.sheetBriefText(impossible);
  assert.match(brief, /Cannot break even in this room at this guarantee/);
  assert.match(brief, /Break-even: 2,084 tickets \(208\.4% of room capacity 1,000/);
  // Unknown capacity: no cannot line, no percentage anywhere in the brief.
  const unknownBrief = sandbox.sheetBriefText(verdictFixture());
  assert.doesNotMatch(unknownBrief, /Cannot break even/);
  assert.doesNotMatch(unknownBrief, /%/);
});

// T3-P1: the proof pack carries capacity + cannot verdict, but no new claim.
test('T3 proof pack carries capacity state and the cannot verdict', () => {
  const { sandbox } = loadApp();
  const impossible = verdictFixture({
    capacity: { state: 'known', value: 1000, source: 'user-supplied, not Ticketmaster-verified' },
    breakEven: { tickets: 2084, net: 120, verdict: 'Cannot break even in this room at this guarantee', price: { value: 120, source: 'user-supplied' }, variableCost: { value: null, provided: false } },
  });
  const pack = sandbox.buildProofPackObject(structuredClone(impossible));
  assert.equal(pack.breakEven.verdict, 'Cannot break even in this room at this guarantee');
  assert.equal(pack.breakEven.capacity.value, 1000);
  assert.equal(pack.breakEven.capacity.state, 'known');
  const unknownPack = sandbox.buildProofPackObject(structuredClone(verdictFixture()));
  assert.equal(unknownPack.breakEven.verdict, null);
  assert.equal(unknownPack.breakEven.capacity.state, 'unknown');
});

// T3-P3: hideVerdict removes the out-of-section 'how this verdict was made'
// summary, so a later withheld run never shows the previous run's legs.
test('T3 hideVerdict removes the how-made summary from a previous verdict', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(verdictFixture(), false);
  // wireVerdictAids creates the summary dynamically; the shim document has
  // no parentNode wiring, so seed it explicitly to model the live DOM.
  const howMade = get('howMade');
  sandbox.hideVerdict();
  assert.equal(howMade._removed, true);
  assert.equal(get('diagramLive').hidden, true);
  assert.equal(get('diagramCeil').textContent, '—');
});

// T3: thin badge is broader than LOW by design — locked, not 'fixed' away.
// Ranked-empty with areas + tags present is MEDIUM (not LOW) yet still
// earns the badge, because the verdict rests on an unranked shortlist.
test('T3 thin badge shows on an unranked shortlist even when confidence is MEDIUM', () => {
  const { sandbox, get } = loadApp();
  // Realistic unranked path: the rank leg did not return ok (recommend
  // supplied the candidates instead), so the core-7 check fails and the
  // level is MEDIUM — while the badge still fires on the empty ranked list.
  const v = verdictFixture({
    openers: { ranked: [], candidates: [{ name: 'Clairo' }], topPick: 'Clairo' },
  });
  v.legs.rank = { status: 'empty', reason: 'no data for this entity/region' };
  sandbox.renderVerdict(v, false);
  assert.match(get('confidenceBox').innerHTML, /MEDIUM/);
  assert.equal(get('thinBadge').hidden, false);
});
