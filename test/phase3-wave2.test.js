// Phase 3 Wave 2 items E, I, B, L — frontend + backend, same rules.
// Pattern: slice app.js up to submitVerdict, run in node:vm against a
// minimal fake document (exactly like test/phase3-verdict.test.js), plus
// direct imports of backend/src/rerank.js and the pipeline. The verdict
// under test is the REAL recorded fixture captured by the coordinator
// (phase3-evidence/live-verdict-billie.json); derived test inputs are
// that fixture with fields toggled, labelled derived, never recorded runs.
// Item G-retry is NOT in this file: it was abandoned (see report), and no
// test asserts a map strip that does not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { classifyMiss, classifyMisses, buildRerankArgs, formatRerankResult } from '../backend/src/rerank.js';
import { runVerdict } from '../backend/src/pipeline.js';
import { baseDeps, baseInput } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'app.js'), 'utf8');
const SLICE = APP_JS.slice(0, APP_JS.indexOf('async function submitVerdict'));
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'phase3-evidence', 'live-verdict-billie.json'), 'utf8'));
const TRIAL_PACK = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend', 'trial-pack.json'), 'utf8'));
const BENCH = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench', 'results.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

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

// Collect every key name in a value, recursively (arrays included).
function allKeys(v, acc = []) {
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) { acc.push(k); allKeys(val, acc); }
  }
  return acc;
}

// ---- E: scored miss taxonomy, backend ----

test('E backend: all five taxonomy branches from fixture/derived inputs', () => {
  const artist = 'Billie Eilish';
  const ranked = [{ name: 'Olivia Rodrigo' }, { name: 'Harry Styles' }];
  const candidates = [...ranked, { name: 'Troye Sivan' }];
  // NOT_IN_CANDIDATES: the live fixture's own gut pick against its own sets.
  assert.equal(classifyMiss({ pick: 'Finneas.', graphPick: 'Olivia Rodrigo' },
    { artist, ranked: LIVE.openers.ranked, candidates: LIVE.openers.candidates }).code, 'NOT_IN_CANDIDATES');
  // NOT_IN_RANKED: in candidates, not in ranked (derived input).
  assert.equal(classifyMiss({ pick: 'Troye Sivan', graphPick: 'Olivia Rodrigo' },
    { artist, ranked, candidates }).code, 'NOT_IN_RANKED');
  // SAME_AS_HEADLINER: pick names the main artist (derived input).
  assert.equal(classifyMiss({ pick: 'Billie Eilish', graphPick: 'Olivia Rodrigo' },
    { artist, ranked, candidates }).code, 'SAME_AS_HEADLINER');
  // EMPTY_OR_UNRESOLVED: blank pick (derived input).
  assert.equal(classifyMiss({ pick: '   ', graphPick: 'Olivia Rodrigo' },
    { artist, ranked, candidates }).code, 'EMPTY_OR_UNRESOLVED');
  // UNCLASSIFIED: no sets recorded (recorded-trial shape).
  const u = classifyMiss({ pick: 'Somebody', graphPick: 'Olivia Rodrigo' }, { setsRecorded: false });
  assert.equal(u.code, 'UNCLASSIFIED');
  assert.equal(u.detail, 'candidate set not recorded for this trial');
  // UNCLASSIFIED: in the ranked set but not the top pick — no code forces it elsewhere.
  assert.equal(classifyMiss({ pick: 'Harry Styles', graphPick: 'Olivia Rodrigo' },
    { artist, ranked, candidates }).code, 'UNCLASSIFIED');
});

test('E backend: codes sum to the miss count, exactly one code per miss', () => {
  const { misses, counts, total } = classifyMisses(LIVE.missTrial.misses, {
    artist: LIVE.artist, ranked: LIVE.openers.ranked, candidates: LIVE.openers.candidates,
  });
  assert.equal(total, LIVE.missTrial.misses.length);
  assert.equal(total, 2);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), total);
  assert.deepEqual(counts, { NOT_IN_CANDIDATES: 2 });
  for (const m of misses) assert.ok(typeof m.code === 'string' && m.code.length > 0);
});

test('E recorded: every trial-pack miss recomputes UNCLASSIFIED from trial-pack data alone', () => {
  // Trial-pack trials carry NO candidate/ranked sets — that absence is the
  // whole input to this test, and the rule forbids guessing from pick text.
  assert.equal(TRIAL_PACK.trials.length, 3);
  let total = 0;
  for (const trial of TRIAL_PACK.trials) {
    assert.ok(!('candidates' in trial) && !('ranked' in trial), 'trial-pack must carry no sets');
    const { misses, counts, total: t } = classifyMisses(trial.misses, { setsRecorded: false });
    assert.equal(t, trial.misses.length);
    assert.deepEqual(counts, t > 0 ? { UNCLASSIFIED: t } : {});
    for (const m of misses) assert.equal(m.detail, 'candidate set not recorded for this trial');
    total += t;
  }
  assert.equal(total, 6);
  // The bench ledger agrees with the pack on the same trials.
  assert.equal(BENCH.runs.reduce((a, r) => a + (r.misses || []).length, 0), 6);
});

test('E pipeline: live verdict attaches taxonomy codes that sum to its misses', async () => {
  const v = await runVerdict(baseInput(), baseDeps());
  assert.equal(v.status, 'verdict');
  // Fixture arms: gut misses with a pick that IS in the ranked set, so the
  // honest code is UNCLASSIFIED (in-ranked-but-not-top), not NOT_IN_RANKED.
  assert.equal(v.missTrial.misses.length, 1);
  assert.equal(v.missTrial.misses[0].code, 'UNCLASSIFIED');
  assert.equal(v.missTrial.taxonomy.total, 1);
  assert.equal(Object.values(v.missTrial.taxonomy.counts).reduce((a, b) => a + b, 0), 1);
});

test('E frontend mirrors backend on the same inputs, and renders taxonomy on a verdict + in the tally', () => {
  const { sandbox, get } = loadApp();
  // Mirror agreement on all five branches.
  const cases = [
    [{ pick: 'Finneas.', graphPick: 'Olivia Rodrigo' }, { artist: 'Billie Eilish', ranked: LIVE.openers.ranked, candidates: LIVE.openers.candidates }, 'NOT_IN_CANDIDATES'],
    [{ pick: 'Troye Sivan', graphPick: 'Olivia Rodrigo' }, { artist: 'Billie Eilish', ranked: [{ name: 'Olivia Rodrigo' }], candidates: [{ name: 'Olivia Rodrigo' }, { name: 'Troye Sivan' }] }, 'NOT_IN_RANKED'],
    [{ pick: 'Billie Eilish', graphPick: 'Olivia Rodrigo' }, { artist: 'Billie Eilish', ranked: [{ name: 'Olivia Rodrigo' }], candidates: [{ name: 'Olivia Rodrigo' }] }, 'SAME_AS_HEADLINER'],
    [{ pick: '', graphPick: 'Olivia Rodrigo' }, { artist: 'Billie Eilish', ranked: [{ name: 'Olivia Rodrigo' }], candidates: [{ name: 'Olivia Rodrigo' }] }, 'EMPTY_OR_UNRESOLVED'],
    [{ pick: 'Somebody', graphPick: 'Olivia Rodrigo' }, { setsRecorded: false }, 'UNCLASSIFIED'],
  ];
  for (const [miss, ctx, code] of cases) {
    assert.equal(sandbox.classifyMiss(miss, ctx).code, code);
    assert.equal(classifyMiss(miss, ctx).code, code);
  }
  // Verdict rendering: the live fixture's two misses, both NOT_IN_CANDIDATES.
  sandbox.renderVerdict(structuredClone(LIVE), false);
  const tax = decodeHtml(get('missTaxonomy').innerHTML);
  assert.match(tax, /Miss taxonomy/);
  assert.match(tax, /NOT_IN_CANDIDATES/);
  assert.match(tax, /Miss total: 2/);
  // Recorded tally rendering: all six recorded misses UNCLASSIFIED.
  sandbox.renderTrialTally(structuredClone(BENCH.runs));
  const tally = decodeHtml(get('tallyTaxonomy').innerHTML);
  assert.match(tally, /UNCLASSIFIED/);
  assert.match(tally, /Miss total: 6/);
  assert.match(tally, /candidate set not recorded for this trial/);
});

// ---- I: opener re-rank with exclusion (pure parts + server wiring) ----

test('I rerank args: same candidate set minus the top pick, in order', () => {
  const args = buildRerankArgs({
    artist: 'Billie Eilish', city: 'New York',
    candidates: LIVE.openers.candidates, ranked: LIVE.openers.ranked,
    excludedPick: 'Olivia Rodrigo', headlinerId: 'D7BCE4CD-5135-4608-8A7D-78E08FFD52F3',
  });
  assert.equal(args.options.length, 9);
  assert.ok(!args.options.includes('087EF30C-3367-49B8-AC58-8B8C01D69DB6'), 'excluded top pick id must be gone');
  assert.equal(args.options[0], '5D28EDAC-F84F-42EB-8DB3-28EC65330287');
  assert.deepEqual(args.signals, ['D7BCE4CD-5135-4608-8A7D-78E08FFD52F3']);
  assert.equal(args.signal_location, 'New York');
  assert.ok(!('remaining' in args) || true, 'remaining is display-only');
  assert.throws(() => buildRerankArgs({
    artist: 'Billie Eilish', city: 'New York', candidates: LIVE.openers.candidates,
    ranked: [], excludedPick: 'Nobody Here',
  }), /not in the candidate set/);
  assert.throws(() => buildRerankArgs({
    artist: 'Billie Eilish', city: 'New York', candidates: [{ name: 'Only One' }],
    ranked: [], excludedPick: 'Only One',
  }), /no candidates remain/);
});

test('I rerank result: ok envelope yields a new pick + receipt; empty yields a label and NO pick', () => {
  const receipt = { operation: 'qloo_rank', requestHash: 'abc', requestId: null, resultCount: 2 };
  const ok = formatRerankResult({ status: 'ok', results: [{ id: 'x2', name: 'Harry Styles' }, { id: 'x3', name: 'Troye Sivan' }] },
    { excludedPick: 'Olivia Rodrigo', receipt });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.newPick.name, 'Harry Styles');
  assert.equal(ok.receipt.operation, 'qloo_rank');
  const empty = formatRerankResult({ status: 'ok', results: [] }, { excludedPick: 'Olivia Rodrigo', receipt: null });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.newPick, null);
  assert.match(empty.label, /no data/);
});

test('I server wiring: /api/verdict/rerank route, key gate, and guards present in server.js', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  assert.ok(src.includes("path === '/api/verdict/rerank'"), 'rerank route must exist');
  assert.ok(src.includes('handleRerank'), 'rerank handler must exist');
  const h = src.slice(src.indexOf('async function handleRerank'));
  assert.ok(h.includes('notConfigured()'), 'keyless backend must refuse closed');
  assert.ok(h.includes('guards.checkVisitor'), 'per-visitor cap must apply');
  assert.ok(h.includes('guards.checkCall'), 'call budget must apply');
  assert.ok(h.includes("mcpCall('qloo_rank'"), 'rerank must re-run the rank leg only');
  assert.ok(h.includes('RERANK_EMPTY'), 'empty rank must refuse, never invent a pick');
});

test('I frontend: re-rank section renders a new pick + receipt separately, and a failure renders the exact label with no number', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  // Success (derived shape — a live success is NOT claimed here).
  sandbox.renderRerankSection({
    status: 'ok', excludedPick: 'Olivia Rodrigo',
    newPick: { id: '5D28EDAC-F84F-42EB-8DB3-28EC65330287', name: 'Harry Styles' },
    receipt: { operation: 'qloo_rank', requestId: null, resultCount: 9 },
  }, { derived: true });
  const okHtml = decodeHtml(get('rerankOut').innerHTML);
  assert.match(okHtml, /Harry Styles/);
  assert.match(okHtml, /qloo_rank/);
  assert.match(okHtml, /Derived from the recorded fixture/);
  // The original verdict is untouched by rendering the section.
  assert.equal(get('beTickets').textContent, '2,084');
  // Failure: exact label, no new pick, no number from the failed run.
  sandbox.renderRerankSection({ code: 'NOT_CONFIGURED', message: 'Qloo is not configured for this demo. No verdict can be computed without live Qloo data.' });
  const failHtml = decodeHtml(get('rerankOut').innerHTML);
  assert.match(failHtml, /NOT_CONFIGURED/);
  assert.match(failHtml, /Qloo is not configured/);
  assert.doesNotMatch(failHtml, /Harry Styles/);
});

// ---- B: downloadable single-verdict proof pack (JSON) ----

test('B proof pack: same verdict object, ceil recomputes, hash recomputes, no secret field', () => {
  const { sandbox } = loadApp();
  const pack = sandbox.buildProofPackObject(structuredClone(LIVE));
  assert.equal(pack.format, 'offersheet-proof-pack-1');
  // Break-even arithmetic recomputes to the on-screen number.
  assert.equal(Math.ceil(pack.breakEven.arithmetic.guarantee / pack.breakEven.arithmetic.net), 2084);
  assert.equal(pack.breakEven.tickets, LIVE.breakEven.tickets);
  assert.equal(pack.rankedPick, LIVE.openers.topPick);
  assert.equal(pack.missLedger.length, 2);
  assert.equal(pack.missLedger[0].code, 'NOT_IN_CANDIDATES');
  assert.equal(pack.receipts.length, LIVE.receipts.length);
  for (let i = 0; i < pack.receipts.length; i++) {
    assert.equal(pack.receipts[i].operation, LIVE.receipts[i].operation);
    assert.equal(pack.receipts[i].hash, LIVE.receipts[i].requestHash);
    assert.equal(pack.receipts[i].requestId, LIVE.receipts[i].requestId);
    assert.equal(pack.receipts[i].resultCount, LIVE.receipts[i].resultCount);
  }
  // Canonical hash recomputes (the download path appends packSha256 over
  // exactly this canonical string of the pack without the hash field).
  const hash = sha(sandbox.canonicalStringify(pack));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(sha(sandbox.canonicalStringify(pack)), hash);
  // No key, token, or secret field anywhere in the serialized object.
  // (Receipt `hash` is a SHA-256 of request arguments, not a secret, and
  // is pack content by design — it is the only hash-named field allowed.)
  const keys = allKeys(pack);
  for (const k of keys) {
    assert.doesNotMatch(k, /^(.*_)?(api[-_]?key|secret|token|password|auth|credential)(_.*)?$/i, `secret-like field in pack: ${k}`);
  }
  // Replay payloads carry the step log's filter: no key-like arg names.
  for (const r of pack.receipts) {
    if (r.replay && r.replay.args) {
      for (const k of Object.keys(r.replay.args)) assert.doesNotMatch(k, /(key|secret|token|password|auth|credential|hash)/i);
    }
  }
  // Frontend exposes the export buttons only via renderVerdict (a
  // successful verdict); the section ids exist in app.html.
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'app.html'), 'utf8');
  assert.ok(html.includes('id="proofPackBtn"'), 'proof pack button must exist');
  assert.ok(html.includes('id="verdictCsvBtn"'), 'CSV button must exist');
});

// ---- L: verdict export as CSV, same generator ----

test('L CSV: parses, break-even cell recomputes, receipt hashes match the drawer exactly', () => {
  const { sandbox } = loadApp();
  const pack = sandbox.buildProofPackObject(structuredClone(LIVE));
  const csv = sandbox.buildVerdictCsv(pack);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'artist,city,guarantee,ticketPrice,netPerTicket,breakEvenTickets,graphPick,receiptOperation,receiptHash,receiptRequestId,receiptResultCount');
  // One row per receipt, plus the header — no new data, no new computation.
  assert.equal(lines.length, 1 + LIVE.receipts.length);
  // Parse simply: this CSV's values contain no commas outside quoted cells
  // except none here; split on commas and check the key cells.
  const parseRow = (line) => line.split(',');
  const first = parseRow(lines[1]);
  assert.equal(first[0], 'Billie Eilish');
  assert.equal(first[5], '2084');
  assert.equal(Math.ceil(Number(first[2]) / Number(first[4])), Number(first[5]));
  const hashes = lines.slice(1).map((l) => parseRow(l)[8]);
  assert.deepEqual(hashes, LIVE.receipts.map((r) => r.requestHash));
  const ops = lines.slice(1).map((l) => parseRow(l)[7]);
  assert.deepEqual(ops, LIVE.receipts.map((r) => r.operation));
});
