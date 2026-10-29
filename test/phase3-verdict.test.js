// Phase 3 verdict items A + D + C, frontend-only.
// Pattern: slice app.js up to submitVerdict, run in node:vm against a
// minimal fake document — exactly like test/ship-items.test.js.
// The verdict under test is the REAL recorded fixture captured by the
// coordinator (phase3-evidence/live-verdict-billie.json); derived test
// inputs below are that fixture with leg statuses toggled, and are
// labelled as derived test inputs, never as recorded runs.
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
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'phase3-evidence', 'live-verdict-billie.json'), 'utf8'));

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

function decodeHtml(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function stepLogs(get) {
  return get('receiptList').children.map((c) => {
    const html = c.innerHTML;
    const at = html.indexOf('Step log');
    return at === -1 ? '' : decodeHtml(html.slice(at));
  });
}

// A: every receipt row carries an expandable step log whose parameters
// are exactly the receipt's recorded replay payload.
test('A: step log parameters equal the recorded replay payload, per receipt', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  const logs = stepLogs(get);
  assert.equal(logs.length, LIVE.receipts.length);
  LIVE.receipts.forEach((r, i) => {
    const log = logs[i];
    assert.match(log, new RegExp(`Step: ${r.operation.replace(/_/g, '_')}`));
    assert.match(log, new RegExp(`results: ${r.resultCount}`));
    if (Object.keys(r.replay.args).length === 0) {
      assert.match(log, /\(no parameters\)/);
    } else {
      const m = log.match(/parameters: <code>(.*?)<\/code>/);
      assert.ok(m, `step log for ${r.operation} must carry a parameters block`);
      assert.deepEqual(JSON.parse(m[1]), r.replay.args);
    }
  });
  // Leg-derived status where a leg exists; receipted otherwise.
  assert.match(logs[0], /receipted \(no leg status recorded\)/); // capabilities has no leg
  assert.match(logs[1], /leg ok/); // find_tags leg ok
});

test('A: step log never renders key-like fields, hashes, or receipt ids', () => {
  const { sandbox, get } = loadApp();
  // Derived test input (NOT a recorded run): one receipt whose replay
  // payload carries a key-like argument, which the log must drop.
  const v = structuredClone(LIVE);
  v.receipts = [{
    claim: 'derived test receipt', operation: 'qloo_find_tags', requestId: null,
    resultCount: 1, replay: { kind: 'mcp', tool: 'qloo_find_tags', args: { query: 'Test Artist', apiKey: 'must-never-render', limit: 5 } },
  }];
  sandbox.renderVerdict(v, false);
  const log = stepLogs(get)[0];
  assert.match(log, /Test Artist/);
  assert.doesNotMatch(log, /apiKey/);
  assert.doesNotMatch(log, /must-never-render/);
  // Real fixture: no step log carries a request hash or a receipt id.
  const app2 = loadApp();
  app2.sandbox.renderVerdict(structuredClone(LIVE), false);
  for (const log of stepLogs(app2.get)) {
    assert.doesNotMatch(log, /requestHash/);
    assert.doesNotMatch(log, /hashKind/);
  }
  for (const r of LIVE.receipts) {
    assert.ok(!stepLogs(app2.get).some((log) => log.includes(r.id)), `step log must not carry receipt id ${r.id}`);
  }
});

test('A: no step log without a verdict; no parameters without a replay payload', () => {
  const { get } = loadApp();
  assert.equal(get('receiptList').innerHTML, '');
  assert.doesNotMatch(get('receiptList').innerHTML, /Step log/);
  const app2 = loadApp();
  // Derived test input (NOT a recorded run): receipt with no replay.
  const v = structuredClone(LIVE);
  v.receipts = [{ claim: 'derived test receipt', operation: 'qloo_describe', requestId: null, resultCount: 1 }];
  app2.sandbox.renderVerdict(v, false);
  const log = stepLogs(app2.get)[0];
  assert.match(log, /no replay payload recorded for this receipt, so no parameters are shown/);
  assert.doesNotMatch(log, /parameters: <code>/);
});

// D: every rendered verdict section carries a source tag; the arithmetic
// line gets user-supplied + venue-history tags and never a receipt tag.
test('D: source tags on every section; arithmetic line never receipt-backed', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  const arith = get('arithmeticSourceTag').innerHTML;
  assert.match(arith, /user-supplied/);
  assert.match(arith, /venue-history-sourced/);
  assert.doesNotMatch(arith, /Source: receipt-backed/);
  const formula = get('formulaSourceTag').innerHTML;
  assert.match(formula, /user-supplied/);
  assert.doesNotMatch(formula, /Source: receipt-backed/);
  // Receipt-backed sections carry the receipt index they trace to:
  // recommend is receipt 3, demographics 5, entity_tags 6 in the fixture.
  assert.match(get('openerSourceTag').innerHTML, /Source: receipt-backed/);
  assert.match(get('openerSourceTag').innerHTML, /data-receipt-idx="3"/);
  assert.match(get('evidenceSourceTag').innerHTML, /data-receipt-idx="5"/);
  assert.match(get('evidenceSourceTag').innerHTML, /data-receipt-idx="6"/);
  assert.match(get('citeChips').innerHTML, /Source: receipt-backed/);
  assert.match(get('sheetSourceTag').innerHTML, /Source: receipt-backed/);
  // Checklist rows: opener receipt-backed, price user-supplied, capacity
  // unknown with no invented source.
  const checklist = get('signChecklist').innerHTML;
  assert.match(checklist, /Opener:<\/strong> Olivia Rodrigo .*Source: receipt-backed/);
  assert.match(checklist, /Ticket price:<\/strong> \$120 \(user-supplied\) .*Source: user-supplied/);
  assert.match(checklist, /Capacity:<\/strong> Unknown .*Source: unknown — no source/);
  // Sections with no backing this run say so instead of claiming one.
  assert.match(get('audienceSourceTag').innerHTML, /not receipt-backed this run/);
  assert.match(get('proofSummary').innerHTML, /Top shared tag:<\/strong> Cod Fish .*Source: receipt-backed/);
  assert.match(get('proofSummary').innerHTML, /Trend:<\/strong> not returned this run .*not receipt-backed this run/);
  // Arms: LLM lanes are comparison-arm output, Graph lane receipt-backed.
  const arms = get('armsBlock').innerHTML;
  assert.match(arms, /comparison-arm output/);
  assert.match(arms, /Source: receipt-backed/);
  assert.ok(get('legsSourceTag').innerHTML.length > 0);
  assert.ok(get('receiptSourceTag').innerHTML.length > 0);
  assert.ok(get('armsSourceTag').innerHTML.length > 0);
});

test('D: no section claims receipt backing when the run has no receipts', () => {
  const { sandbox, get } = loadApp();
  // Derived test input (NOT a recorded run): the fixture with receipts removed.
  const v = structuredClone(LIVE);
  v.receipts = [];
  sandbox.renderVerdict(v, false);
  for (const id of ['openerSourceTag', 'evidenceSourceTag', 'citeChips', 'sheetSourceTag', 'arithmeticSourceTag']) {
    assert.doesNotMatch(get(id).innerHTML, /Source: receipt-backed/, `${id} must not claim receipt backing without a receipt`);
  }
  assert.match(get('arithmeticSourceTag').innerHTML, /user-supplied/);
});

// C: a verdict with one emptied backing leg strikes that line, and the
// copied brief contains no claim from the struck line.
test('C: emptied backing leg strikes the Graph line; brief omits it', () => {
  const { sandbox, get } = loadApp();
  // Derived test input (NOT a recorded run): fixture with the recommend
  // leg emptied; rank is already empty, so the Graph pick loses backing.
  const v = structuredClone(LIVE);
  v.legs.recommend = { status: 'empty', reason: 'no data for this entity/region' };
  sandbox.renderVerdict(v, false);
  const body = get('sheetBody').innerHTML;
  assert.match(body, /<s>Graph pick: Olivia Rodrigo<\/s> — not backed — omitted from brief/);
  assert.match(body, /<s>Miss ledger:/);
  assert.match(get('refusedBlock').innerHTML, /not backed — omitted from brief/);
  const brief = sandbox.sheetBriefText(v);
  assert.doesNotMatch(brief, /Graph pick:/);
  assert.doesNotMatch(brief, /Miss:/);
  // Arithmetic lines are never struck for lacking a receipt.
  assert.match(body, /<strong>2,084 tickets to break even<\/strong>/);
  assert.doesNotMatch(body, /<s>.*2,084 tickets to break even/);
  assert.match(brief, /Break-even: 2,084 tickets \(capacity unknown — no sellout percentage\)/);
  assert.match(brief, /Guarantee \$250,000 · ticket price \$120 \(user-supplied\) · net per ticket \$120 \(before variable costs\)/);
});

// C: a full-evidence verdict keeps sheet + brief identical to today's output.
test('C: full-evidence verdict sheet and brief are unregressed', () => {
  const { sandbox, get } = loadApp();
  // Derived test input (NOT a recorded run): fixture with every leg ok.
  const v = structuredClone(LIVE);
  for (const k of Object.keys(v.legs)) v.legs[k] = { status: 'ok' };
  sandbox.renderVerdict(v, false);
  const body = get('sheetBody').innerHTML;
  assert.doesNotMatch(body, /not backed/);
  assert.match(body, /<p>Graph pick: Olivia Rodrigo<\/p>/);
  assert.match(body, /<p>Miss ledger:/);
  assert.match(body, /2,084 tickets to break even/);
  const brief = sandbox.sheetBriefText(v);
  const expected = [
    'OfferSheet verdict — Billie Eilish in New York',
    'Guarantee $250,000 · ticket price $120 (user-supplied) · net per ticket $120 (before variable costs)',
    'Break-even: 2,084 tickets (capacity unknown — no sellout percentage)',
    // G11: the code-filled liveness line (all 13 legs forced ok above).
    'Live legs this run: 13 ok · 0 empty · 0 error.',
    'Graph pick: Olivia Rodrigo',
    'Miss: gut picked Finneas.; Qloo picked Olivia Rodrigo.',
    `Miss: web picked ${LIVE.missTrial.misses[1].pick}; Qloo picked Olivia Rodrigo.`,
    'Unknowns: capacity, variable cost, venue.',
    'Aggregate taste signals only — not a sellout prediction, not a signing recommendation. The promoter decides.',
  ].join('\n');
  assert.equal(brief, expected);
});
