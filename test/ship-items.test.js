// SHIP round tests (29 Oct 2026): the 15 sweep adoptions, frontend-only.
// Pattern: slice app.js up to submitVerdict, run in node:vm against a
// minimal fake document — exactly like test/needs-input-picker.test.js.
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
    setTimeout: (fn) => { /* no-op: flash timers never fire in tests */ },
  };
  sandbox.window.document = doc;
  vm.createContext(sandbox);
  vm.runInContext(SLICE, sandbox);
  return { sandbox, get: (id) => doc.getElementById(id) };
}

const UNKNOWN_CAP = 'Venue capacity unknown — Ticketmaster returned no capacity for this room. Break-even is shown as tickets needed, not as a sellout percentage. Verify room size before signing.';

function verdictFixture(overrides = {}) {
  const base = {
    artist: 'Billie Eilish', city: 'New York', guarantee: 250000,
    breakEven: { tickets: 2084, net: 120, price: { value: 120, source: 'user-supplied' }, variableCost: { value: null, provided: false } },
    capacity: { state: 'unknown', message: UNKNOWN_CAP },
    audience: { note: 'Qloo returns matched areas/entities, not a headcount.', areas: [{ name: 'New York' }] },
    openers: { ranked: ['Olivia Rodrigo'], candidates: ['Olivia Rodrigo', 'Clairo'], topPick: 'Olivia Rodrigo' },
    demographics: [{ band: '18-24' }],
    trends: null, sharedTags: ['Cod Fish'], overlap: null,
    arms: {
      gut: { arm: 'gut', status: 'ok', pick: 'Clairo', provider: 'qwen' },
      web: { arm: 'web', status: 'ok', pick: 'Armani White', provider: 'qwen' },
      graph: { arm: 'graph', status: 'ok', pick: 'Olivia Rodrigo' },
    },
    missTrial: { misses: [
      { arm: 'gut', pick: 'Clairo', graphPick: 'Olivia Rodrigo' },
      { arm: 'web', pick: 'Armani White', graphPick: 'Olivia Rodrigo' },
    ] },
    ticketmaster: { status: 'ok', venueName: 'Madison Square Garden' },
    osm: { status: 'ok', displayName: 'New York', scope: 'display-only' },
    wikidata: { status: 'ok', scope: 'input to the Web arm only' },
    legs: {
      findTags: { status: 'ok' }, describe: { status: 'ok' }, recommend: { status: 'ok' },
      rank: { status: 'ok' }, wherePopular: { status: 'ok' }, demographics: { status: 'ok' },
      entityTags: { status: 'ok' }, trends: { status: 'empty', reason: 'no data' },
      compare: { status: 'empty', reason: 'no data' },
      restSearch: { status: 'error', reason: 'Qloo REST returned 429' },
      restInsights: { status: 'empty', reason: 'no data' },
      restCompare: { status: 'skipped', reason: 'no headliner+opener IDs' },
      restEntities: { status: 'error', reason: 'Qloo REST returned 429' },
    },
    receipts: [
      { claim: 'Graph rank for this city', operation: 'qloo_rank', requestId: 'req-1', resultCount: 3, ids: ['a', 'b'] },
      { claim: 'Headliner entity card', operation: 'qloo_describe', requestId: 'req-2', resultCount: 1, ids: ['x'] },
    ],
    timingMs: 35319,
  };
  return { ...base, ...overrides };
}

function benchRuns() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'bench', 'results.json'), 'utf8')).runs;
}

// Item 1: chips cite the Graph pick + each miss to the existing receipt;
// the arithmetic line gets NO chip (its inputs have no receipt).
test('item 1: citation chips cite pick + misses, never the arithmetic line', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(verdictFixture(), false);
  const html = get('citeChips').innerHTML;
  assert.match(html, /Graph pick Olivia Rodrigo — qloo_rank · requestId req-1/);
  assert.match(html, /Miss: gut picked Clairo; Qloo picked Olivia Rodrigo/);
  assert.match(html, /Miss: web picked Armani White; Qloo picked Olivia Rodrigo/);
  assert.doesNotMatch(html, /ceil/);
  // No receipts at all → no invented chip, honest note instead.
  const app2 = loadApp();
  app2.sandbox.renderVerdict(verdictFixture({ receipts: [] }), false);
  assert.match(app2.get('citeChips').innerHTML, /No Qloo-backed citation chip this run/);
});

// Item 2: % of room + impossible verdict ONLY when capacity is known.
test('item 2: sellout % and impossible verdict are capacity-known only', () => {
  const known = loadApp();
  known.sandbox.renderVerdict(verdictFixture({ capacity: { state: 'known', value: 20000, source: 'user-supplied, not Ticketmaster-verified' } }), false);
  assert.equal(known.get('selloutBox').hidden, false);
  assert.equal(known.get('selloutPct').textContent, '10.4%');
  assert.equal(known.get('cannotBox').hidden, true);
  assert.equal(known.get('beCapacity').textContent, '20,000 (user-supplied, not Ticketmaster-verified)');

  const impossible = loadApp();
  impossible.sandbox.renderVerdict(verdictFixture({ capacity: { state: 'known', value: 1000, source: 'user-supplied, not Ticketmaster-verified' } }), false);
  assert.equal(impossible.get('cannotBox').hidden, false);
  assert.equal(impossible.get('selloutPct').textContent, '208.4%');

  const unknown = loadApp();
  unknown.sandbox.renderVerdict(verdictFixture(), false);
  assert.equal(unknown.get('selloutBox').hidden, true);
  assert.equal(unknown.get('cannotBox').hidden, true);
  assert.equal(unknown.get('unknownBox').hidden, false);
  assert.equal(unknown.get('unknownText').textContent, UNKNOWN_CAP);
});

// Item 4: deterministic confidence levels + tie/unranked disclosures.
test('item 4: confidence is code-set from leg coverage', () => {
  const allOk = loadApp();
  const legsOk = {};
  for (const k of ['findTags', 'describe', 'recommend', 'rank', 'wherePopular', 'demographics', 'entityTags', 'trends', 'compare']) legsOk[k] = { status: 'ok' };
  allOk.sandbox.renderVerdict(verdictFixture({ legs: legsOk }), false);
  assert.match(allOk.get('confidenceBox').innerHTML, /HIGH/);
  assert.match(allOk.get('confidenceBox').innerHTML, /evidence strength, not probability/);
  assert.match(allOk.get('confidenceBox').innerHTML, /near-tie cannot be ruled out/);

  const mixed = loadApp();
  mixed.sandbox.renderVerdict(verdictFixture(), false);
  assert.match(mixed.get('confidenceBox').innerHTML, /MEDIUM/);

  const thin = loadApp();
  thin.sandbox.renderVerdict(verdictFixture({
    openers: { ranked: [], candidates: ['Clairo'], topPick: 'Clairo' },
    audience: { note: 'n', areas: [] },
  }), false);
  assert.match(thin.get('confidenceBox').innerHTML, /LOW/);
  assert.match(thin.get('confidenceBox').innerHTML, /first candidate returned, not a ranked winner/);
});

// Item 8: leg summary + ok/partial badges from leg status only.
test('item 8: leg summary counts dropped legs; badges mark ok vs partial', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(verdictFixture(), false);
  assert.match(get('legSummary').textContent, /6 legs dropped/);
  assert.match(get('legSummary').textContent, /1 opener candidate shown unranked/);
  assert.match(sandbox.legRowHtml('trends', { status: 'empty', reason: 'no data' }), /leg-state--partial/);
  assert.match(sandbox.legRowHtml('rank', { status: 'ok' }), /leg-state--ok/);
});

// Item 9: thin badge, no-forced-winner top pick, no-equivalent sentence.
test('item 9: thin badge + no forced winner', () => {
  const full = loadApp();
  full.sandbox.renderVerdict(verdictFixture(), false);
  assert.equal(full.get('thinBadge').hidden, true);
  assert.equal(full.get('topPick').textContent, 'Graph pick: Olivia Rodrigo');

  const thin = loadApp();
  thin.sandbox.renderVerdict(verdictFixture({
    openers: { ranked: [], candidates: ['Clairo'], topPick: 'Clairo' },
  }), false);
  assert.equal(thin.get('thinBadge').hidden, false);
  assert.match(thin.get('thinBadge').textContent, /Thin data/);
  assert.match(thin.get('topPick').textContent, /First candidate \(unranked — no ranked winner this run\): Clairo/);

  const none = loadApp();
  none.sandbox.renderVerdict(verdictFixture({
    openers: { ranked: [], candidates: [], topPick: null },
  }), false);
  assert.match(none.get('openerList').innerHTML, /No equivalent cleared the evidence checks — this does not mean none exists/);
});

// Item 10: checklist reflects actual input states.
test('item 10: before-you-sign checklist mirrors the verdict', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(verdictFixture(), false);
  const html = get('signChecklist').innerHTML;
  assert.match(html, /Before you sign/);
  assert.match(html, /Opener:<\/strong> Olivia Rodrigo/);
  assert.match(html, /Venue:<\/strong> Madison Square Garden/);
  assert.match(html, /Unknowns: capacity, variable cost/);
});

// Items 7 + 11: sheet from the same data; refused picks struck through.
test('items 7+11: verdict sheet + struck-through refusals', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(verdictFixture(), false);
  assert.equal(get('verdictSheet').hidden, false);
  const body = get('sheetBody').innerHTML;
  assert.match(body, /2,084 tickets to break even/);
  assert.match(body, /Graph pick: Olivia Rodrigo/);
  assert.match(body, /Miss ledger/);
  assert.match(body, /Unknowns: capacity, variable cost/);
  assert.match(body, /qloo_rank · requestId req-1/);
  assert.match(get('refusedBlock').innerHTML, /<s>Clairo<\/s> — refused: gut pick contradicted by the Qloo Graph pick Olivia Rodrigo/);
  assert.match(get('refusedBlock').innerHTML, /<s>Armani White<\/s>/);
  assert.equal(typeof get('printSheetBtn').onclick, 'function');
  assert.equal(typeof get('copyBriefBtn').onclick, 'function');
  const brief = sandbox.sheetBriefText(verdictFixture());
  assert.match(brief, /Break-even: 2,084 tickets \(capacity unknown — no sellout percentage\)/);
  assert.match(brief, /not a signing recommendation\. The promoter decides\./);
});

// Item 3: tally matches bench/results.json exactly.
test('item 3: Gut-vs-Graph tally matches the 3 recorded trials', () => {
  const runs = benchRuns();
  assert.equal(runs.length, 3);
  const { sandbox, get } = loadApp();
  // Judge-ordered honesty restatement: refusal ≠ differing pick — trial 3's
  // web arm declined to pick, so it counts as webRefused, not webDiffered.
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.computeTrialTally(runs))), { n: 3, gutSame: 0, webSame: 0, changed: 3, webRefused: 1, webDiffered: 2 });
  sandbox.renderTrialTally(runs);
  assert.match(get('tallyLine').textContent, /Qloo changed the pick in 3\/3 trials \(Gut differed in 3\/3; Web picked differently in 2\/3 and declined to pick in 1\/3\)\. Recorded, not live\./);
  const table = get('tallyTable').innerHTML;
  assert.match(table, /Billie Eilish/);
  assert.match(table, /Clairo/);
  assert.match(table, /Olivia Rodrigo/);
  assert.match(table, /Use these inputs/);
  // Trial 3's web cell is a refusal, not a differing pick.
  assert.match(table, /declined \(no pick\)/);
  assert.match(table, /Web declined to pick \(no pick recorded\)/);
  // An arm with no miss entry matched the Graph pick.
  assert.equal(sandbox.pickFor({ graphPick: 'X', misses: [] }, 'gut'), 'X');
  assert.equal(sandbox.pickFor({ graphPick: 'X', misses: [{ arm: 'gut', pick: 'Y' }] }, 'gut'), 'Y');
});

// Item 13: four cards prefill, never auto-run.
test('item 13: trial cards prefill the form; your-artist card starts blank', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderTrialCards(benchRuns());
  const html = get('trialCardsRow').innerHTML;
  assert.match(html, /Billie Eilish/);
  assert.match(html, /Taylor Swift/);
  assert.match(html, /Olivia Rodrigo/);
  assert.match(html, /Your artist/);
  assert.match(html, /recorded 2026-10-29, not live/);
  sandbox.prefillForm({ artist: 'Taylor Swift', city: 'New York', guarantee: 250000, ticketPrice: 120 });
  assert.equal(get('artist').value, 'Taylor Swift');
  assert.equal(get('city').value, 'New York');
  assert.equal(get('guarantee').value, 250000);
  assert.equal(get('ticketPrice').value, 120);
  assert.equal(get('venue').value, '');
});

// Item 9 (withheld branch): submitVerdict is past the render slice, so
// this loader slices up to the offerForm listener and stubs fetch.
function loadAppSubmit() {
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
    Date,
    setTimeout: (fn) => {},
    setInterval: (fn) => 1,
    clearInterval: () => {},
    fetch: async () => { throw new Error('fetch stub not set'); },
  };
  sandbox.window.document = doc;
  vm.createContext(sandbox);
  const submitSlice = APP_JS.slice(0, APP_JS.indexOf("$('offerForm').addEventListener"));
  vm.runInContext(submitSlice, sandbox);
  return { sandbox, get: (id) => doc.getElementById(id) };
}

test('item 9: withheld response names OUTAGE vs THIN DATA refusal kind', async () => {
  const run = async (withheld) => {
    const { sandbox, get } = loadAppSubmit();
    sandbox.fetch = async () => ({ ok: true, json: async () => withheld });
    get('artist').value = 'Billie Eilish';
    get('city').value = 'New York';
    get('guarantee').value = '250000';
    await sandbox.submitVerdict(false);
    return get('status').innerHTML;
  };
  const outage = await run({ status: 'verdict_withheld', message: 'missing', missingLegs: ['rank-or-recommend', 'demographics'], legs: { rank: { status: 'error', reason: 'boom' }, recommend: { status: 'empty' }, demographics: { status: 'ok' } } });
  assert.match(outage, /Verdict withheld: evidence incomplete/);
  assert.match(outage, /Refusal kind: OUTAGE/);
  assert.match(outage, /No numbers are shown in this state/);
  const thin = await run({ status: 'verdict_withheld', message: 'missing', missingLegs: ['where_popular'], legs: { wherePopular: { status: 'empty', reason: 'no data' } } });
  assert.match(thin, /Refusal kind: THIN DATA/);
  assert.match(thin, /No equivalent cleared the evidence checks — this does not mean none exists/);
});

// Static HTML: every new container, link, and copy line exists.
test('static: SHIP containers, links, and copy present on both pages', () => {
  const app = fs.readFileSync(path.join(ROOT, 'frontend', 'app.html'), 'utf8');
  const landing = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
  const docs = fs.readFileSync(path.join(ROOT, 'frontend', 'docs.html'), 'utf8');
  const tools = fs.readFileSync(path.join(ROOT, 'frontend', 'tools.html'), 'utf8');
  for (const id of ['trialCards', 'trialCardsRow', 'trialTally', 'tallyTable', 'tallyLine', 'verdictSheet', 'sheetBody', 'refusedBlock', 'printSheetBtn', 'copyBriefBtn', 'signChecklist', 'confidenceBox', 'thinBadge', 'citeChips', 'legSummary', 'limits']) {
    assert.ok(app.includes(`id="${id}"`), `app.html missing #${id}`);
  }
  assert.ok(app.includes('href="docs.html"'), 'app links docs');
  assert.ok(app.includes('href="tools.html"'), 'app links tools');
  assert.ok(app.includes('href="trial-pack.json"'), 'app links trial pack');
  assert.ok(app.includes('Keys never appear here'), 'receipts key line');
  assert.ok(app.includes('What Qloo doesn\'t decide'), 'limits section');
  assert.ok(app.includes('Cite-or-omit rule'), 'cite-or-omit rule');
  assert.ok(landing.includes('Typical verdict time: 26.2–40.1 seconds'), 'landing timing line');
  assert.ok(landing.includes('measured across the 3 recorded trials, 29 Oct 2026'), 'timing basis');
  assert.ok(!landing.includes('one page, one money decision'), 'landing footer tagline updated');
  assert.ok(!app.includes('one page, one money decision'), 'app footer tagline updated');
  assert.ok(app.includes('one money decision, before you sign'), 'new tagline present');
  assert.match(docs, /HIGH/);
  assert.match(docs, /MEDIUM/);
  assert.match(docs, /LOW/);
  assert.match(docs, /near-tie cannot be ruled out/);
  assert.match(docs, /fail-closed/);
  for (const tool of ['qloo_capabilities', 'qloo_find_tags', 'qloo_describe', 'qloo_recommend', 'qloo_rank', 'qloo_where_popular', 'qloo_audience_demographics', 'qloo_entity_tags', 'qloo_trends', 'qloo_compare_audiences']) {
    assert.ok(tools.includes(tool), `tools.html missing ${tool}`);
  }
  assert.ok(tools.includes('npm install --global @qloo/qloo-harness'), 'tools install block');
  assert.ok(tools.includes('"command": "qloo"'), 'tools mcp block');
  assert.ok(tools.includes('key never leaves the server'), 'tools key line');
  assert.ok(tools.includes('33 tools: 23 OfferSheet tools + 10 guarded Qloo tools'), 'own server stated with the 23+10 split (gate proven 29 Oct 2026)');
  assert.ok(tools.includes('node backend/mcp-server.js'), 'own server start command');
  assert.ok(tools.includes('Proven 29 Oct 2026'), 'own server proof dated');
});

// U20: ledger cards, sources-checked status list, grouped shared tags.
test('U20: trial cards carry a tally computed from the data, three picks and a Why expander', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderTrialTally(benchRuns());
  const html = get('tallyTable').innerHTML;
  assert.equal((html.match(/class="u20-trial"/g) || []).length, 3);
  assert.match(html, /<b>3<\/b><span>recorded trials/);
  assert.match(html, /<b>0\/3<\/b><span>Gut agreed with Graph/);
  assert.match(html, /Gut pick[\s\S]*Qloo pick[\s\S]*Web pick/);
  assert.match(html, /<summary>Why<\/summary>/);
  assert.doesNotMatch(html, /<table/);
});
test('U20: sources checked is one row per check with a pill, method and summary', () => {
  const { sandbox } = loadApp();
  const html = sandbox.sourcesCheckedHtml({ legs: {
    rank: { status: 'ok' }, demographics: { status: 'ok', retried429: true },
    trends: { status: 'empty', envelopeSummary: 'no rows' }, compare: { status: 'error', reason: 'timeout' } } });
  assert.match(html, /2 of 7<\/strong> core checks returned data\./);
  assert.match(html, /0 of 2<\/strong> additional checks returned data\./);
  assert.match(html, /7 checks had no data/);
  assert.equal((html.match(/class="u20-check"/g) || []).length, 9);
  assert.match(html, /u20-pill--retry">[\s\S]*?rate-limited, retried · ok/);
  assert.match(html, /u20-pill--none">no data/);
  assert.match(html, /u20-pill--err">error/);
  assert.match(html, /<code class="u20-check-m">demographics<\/code>/);
});
test('U20: shared tags are grouped by type, music first, the rest kept under Other tag types', () => {
  const { sandbox } = loadApp();
  const html = sandbox.tagsHtml([
    { name: 'Indie Pop', id: 'a', type: 'urn:tag:genre:music' },
    { name: 'Cod Fish', id: 'b', type: 'urn:tag:specialty_dish' },
  ]);
  assert.ok(html.indexOf('Indie Pop') < html.indexOf('Other tag types (1)'));
  assert.match(html, /Cod Fish/, 'non-music tags are kept, not hidden');
  assert.match(html, /raw shared tags/);
});
