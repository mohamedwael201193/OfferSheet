// Phase 3 (Wave 1): Oracle bench panel + pre-registered trial protocol
// + landing nav link. Every bench-panel number is recomputed here from
// trial-pack.json (and cross-checked against bench/results.json) — the
// panel itself is rendered by frontend/oracle.js from the same pack, and
// the exposed benchStats helper is exercised through a DOM-stubbed load
// of oracle.js so the tested computation is the shipped computation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const pack = JSON.parse(read('frontend/trial-pack.json'));
const bench = JSON.parse(read('bench/results.json'));
const oracleJs = read('frontend/oracle.js');
const oracleHtml = read('frontend/oracle.html');
const protocolHtml = read('frontend/trial-protocol.html');
const landingHtml = read('frontend/index.html');
const docsHtml = read('frontend/docs.html');

// Load oracle.js with a minimal DOM stub: the wiring only registers a
// DOMContentLoaded listener at load time, which the stub never fires, so
// no browser state is needed to reach the exposed helpers. WebCrypto is
// stubbed from Node so the shipped SHA-256 path runs unchanged.
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
function loadOracle() {
  const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById: () => null },
    console,
    TextEncoder,
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.crypto = webcrypto;
  vm.createContext(sandbox);
  vm.runInContext(oracleJs, sandbox, { filename: 'oracle.js' });
  return sandbox.window.OfferSheetOracle;
}

test('H: bench panel stats recomputed from the trial pack (shipped computation)', () => {
  const oracle = loadOracle();
  assert.equal(typeof oracle.benchStats, 'function', 'oracle.js must expose benchStats');

  // Independent recomputation straight from the trial pack.
  const timings = pack.trials.map((t) => t.timingMs);
  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]; // odd n: middle value
  const expected = {
    n: pack.trials.length,
    medianMs: median,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };

  const stats = oracle.benchStats(pack.trials);
  assert.equal(stats.n, expected.n);
  assert.equal(stats.medianMs, expected.medianMs);
  assert.equal(stats.minMs, expected.minMs);
  assert.equal(stats.maxMs, expected.maxMs);
  assert.deepEqual(stats.rows.map((r) => r.timingMs), timings);
  assert.deepEqual(
    stats.rows.map((r) => [r.artist, r.city, r.breakEvenTickets, r.misses]),
    pack.trials.map((t) => [
      t.inputs.artist, t.inputs.city, t.breakEvenTickets, t.misses.length,
    ]),
  );

  // The recorded values themselves, pinned so a drift in the pack fails here.
  assert.deepEqual(timings, [35319, 26190, 40119]);
  assert.equal(stats.n, 3);
  assert.equal(stats.medianMs, 35319);
  assert.equal(stats.minMs, 26190);
  assert.equal(stats.maxMs, 40119);
  // Seconds shown in the panel are the same milliseconds divided by 1000.
  assert.equal((stats.medianMs / 1000).toFixed(3), '35.319');
  assert.equal((stats.minMs / 1000).toFixed(3), '26.190');
  assert.equal((stats.maxMs / 1000).toFixed(3), '40.119');
});

test('H: bench panel is tied to bench runs, shows n, and shows no percentile figure', () => {
  // The frozen pack mirrors bench/results.json, including wall times.
  assert.deepEqual(
    bench.runs.map((r) => r.timingMs),
    pack.trials.map((t) => t.timingMs),
  );
  assert.equal(bench.runs.length, 3);

  // Panel skeleton + rendering: prominent n, median/range wording, and the
  // honest gap label — and no percentile figure anywhere in the panel code.
  assert.ok(oracleHtml.includes('id="benchPanel"'), 'oracle.html must carry the bench panel container');
  assert.ok(oracleJs.includes('n = ') && oracleJs.includes('bench-n'),
    'bench panel must label n prominently');
  assert.ok(oracleJs.includes('Median wall time') && oracleJs.includes('Range:'),
    'bench panel must show median and range');
  assert.ok(oracleJs.includes('not recorded in the trial pack'),
    'bench panel must label receipt/leg counts as not recorded');
  assert.ok(!/p(90|95|99)\b/i.test(oracleJs), 'bench panel must show no p90/p95/p99 figure');
  assert.ok(!/\d+(st|nd|rd|th) percentile/i.test(oracleJs),
    'bench panel must show no numbered percentile figure');
  const stats = loadOracle().benchStats(pack.trials);
  assert.deepEqual(Object.keys(stats).sort(), ['maxMs', 'medianMs', 'minMs', 'n', 'rows'],
    'benchStats must carry no percentile field');
});

test('H (gap): receipt/leg counts are indeed absent from the trial pack and bench runs', () => {
  for (const t of pack.trials) {
    assert.ok(!('receipts' in t), 'trial pack carries no per-trial receipts');
    assert.ok(!('receiptCount' in t) && !('legCounts' in t),
      'trial pack carries no structured leg counts');
  }
  for (const r of bench.runs) {
    assert.equal(typeof r.liveLegNotes, 'string',
      'bench liveLegNotes are prose, not counts');
    assert.ok(!('receipts' in r), 'bench runs carry no per-trial receipts');
  }
});

test('J: trial protocol page states all five elements + banner + timestamp, and is linked', () => {
  assert.match(protocolHtml, /ceil\(guarantee ÷ net per-ticket contribution\)/,
    'protocol must state the break-even formula');
  assert.match(protocolHtml, /A miss is recorded when a comparison-arm pick differs from the grounded pick/,
    'protocol must define a miss');
  assert.match(protocolHtml, /A trial counts only when the grounded pick AND at least one comparison pick both came from real runs/,
    'protocol must state the counting rule');
  assert.match(protocolHtml, /An outage means no trial, never a substitute/,
    'protocol must state the fail-closed rule');
  assert.match(protocolHtml, /The trial will be appended regardless of outcome/,
    'protocol must state trials are appended regardless of outcome');
  assert.ok(protocolHtml.includes('NO trial has run under this protocol yet — this protocol is not a trial and is not evidence.'),
    'protocol must carry the not-a-trial banner');
  assert.ok(protocolHtml.includes('datetime="2026-10-29"'),
    'protocol must carry the 2026-10-29 publication timestamp');
  assert.ok(protocolHtml.includes('before any trial under this protocol'),
    'protocol timestamp must predate any trial under it');
  assert.ok(oracleHtml.includes('href="trial-protocol.html"'),
    'oracle.html must link the protocol');
  assert.ok(docsHtml.includes('href="trial-protocol.html"'),
    'docs.html must link the protocol');
  // The protocol page runs no trial and touches no recorded data.
  assert.ok(!protocolHtml.includes('trial-pack.json'),
    'protocol page must not load trial data');
});

test('S1: landing arms tally recomputed from trial-pack.json (same file the app uses)', () => {
  // Independent recomputation from the trial pack's miss data.
  const missed = (t, arm) => (Array.isArray(t.misses) ? t.misses : []).some((m) => m.arm === arm);
  const n = pack.trials.length;
  const gutSame = pack.trials.filter((t) => !missed(t, 'gut')).length;
  const webSame = pack.trials.filter((t) => !missed(t, 'web')).length;
  const changed = pack.trials.filter((t) => missed(t, 'gut') || missed(t, 'web')).length;
  assert.equal(n, 3);
  assert.equal(changed, 3);
  assert.equal(gutSame, 0);
  assert.equal(webSame, 0);

  // D1-B: the landing carries a STATIC tally, computed from trial-pack.json
  // at patch time (no build step exists) and pinned here by recomputation:
  // read the pack, compute changed = trials where gut or web missed, and
  // assert the landing's static string equals "changed of n".
  const armsSection = landingHtml.match(/<section[^>]*id="arms"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(armsSection, 'landing must have an arms section');
  assert.ok(armsSection[1].includes('Recorded, not live.'),
    'tally must be labelled recorded, not live');
  assert.ok(armsSection[1].includes(`Qloo changed the pick in ${changed} of ${n} recorded trials.`),
    'landing static tally must equal the pack recomputation');
  assert.ok(armsSection[1].includes('at patch time'),
    'static tally must state it was computed at patch time');
  assert.ok(!armsSection[1].includes("fetch('trial-pack.json')"),
    'static tally must not fetch at runtime');
  assert.ok(!armsSection[1].includes('Recorded tally unavailable'),
    'no unavailable fallback beside a static number');
  // Display-only preserved: no data endpoint, no verdict machinery.
  // NOSIM NARROWING (30 Oct 2026): the bare-string check used to read
  // the whole landing, but it now contradicts v3-spec, which REQUIRES
  // the honest PWA-note prose "/api/* calls are network-only" in the
  // phone section — prose describing the service worker's real
  // behaviour, not a call. So the PWA-note block is stripped first and
  // the no-endpoint guarantee is kept in full on the remainder, plus
  // a behavioural pin (no fetch/XHR at all in landing markup) so the
  // guarantee is about calls, not about one string.
  const landingWithoutPwaNote = landingHtml.replace(/<p class="pwa-note">[\s\S]*?<\/p>/, '');
  assert.ok(!landingWithoutPwaNote.includes('/api'), 'landing outside the PWA note must name no data endpoint');
  assert.ok(!landingWithoutPwaNote.includes('fetch(') && !landingWithoutPwaNote.includes('XMLHttpRequest'),
    'landing markup must make no data calls');
  assert.ok(!landingHtml.includes('<script src="app.js"'), 'landing must not load app.js');
  const landingJs = read('frontend/landing.js');
  assert.ok(!landingJs.includes('fetch('), 'landing.js must still never fetch');
});

test('S2: cost-of-being-wrong beat carries the verbatim label and checkable arithmetic', () => {
  assert.ok(landingHtml.includes('Illustrative arithmetic on the recorded trial.'),
    'story beat must carry the verbatim label');
  assert.ok(landingHtml.includes('Being wrong by 100 tickets = $12,000 of guarantee exposure (100 × 120 = 12,000)'),
    'story beat must state the 100-ticket arithmetic');
  assert.equal(100 * 120, 12000, 'illustrative arithmetic must recompute');
  assert.ok(landingHtml.includes('That 100-ticket gap is hypothetical — not a measured outcome, not a real loss, and not a prediction.'),
    'the 100-ticket error must be labelled hypothetical, never a real loss or prediction');
});

test('S3: bench-panel re-runnability — record hash + arithmetic recompute, from trial-pack data alone', async () => {
  const oracle = loadOracle();
  assert.equal(typeof oracle.benchRepro, 'function', 'oracle.js must expose benchRepro');
  const canon = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  };
  const { createHash } = await import('node:crypto');
  const expectedHashes = pack.trials.map((t) => createHash('sha256').update(canon(t)).digest('hex'));
  const expectedTickets = pack.trials.map((t) =>
    Math.ceil(t.inputs.guarantee / t.inputs.ticketPrice));

  const repro = await oracle.benchRepro(pack.trials);
  // Spread into host-realm arrays first: vm-realm arrays fail Node's
  // deepEqual on prototype grounds even when every value matches exactly.
  assert.deepEqual([...repro.map((r) => r.recordHash)], expectedHashes,
    'record hash must be SHA-256 of the trial canonical JSON');
  assert.deepEqual([...repro.map((r) => r.expectedTickets)], expectedTickets);
  assert.deepEqual([...repro.map((r) => r.recordedTickets)],
    pack.trials.map((t) => t.breakEvenTickets));
  assert.deepEqual([...repro.map((r) => r.matches)], [true, true, true]);

  // The two named recomputes, pinned explicitly.
  assert.equal(Math.ceil(250000 / 120), 2084);
  assert.equal(Math.ceil(180000 / 95), 1895);
  assert.equal(repro[0].expectedTickets, 2084);
  assert.equal(repro[2].expectedTickets, 1895);

  // The panel renders both per-trial lines.
  assert.ok(oracleJs.includes('Record hash (SHA-256 of canonical trial JSON)'),
    'bench panel must render the per-trial record hash');
  assert.ok(oracleJs.includes('Arithmetic recompute: ceil(guarantee ÷ net)'),
    'bench panel must render the per-trial arithmetic recompute status');
});

test('S4-addition: protocol change log + insufficient-data rule, banner intact', () => {
  assert.ok(protocolHtml.includes('Change log'), 'protocol must carry a change log');
  assert.ok(protocolHtml.includes('v1 — 29 October 2026: initial publication'),
    'change log must carry the initial version entry dated 2026-10-29');
  assert.ok(protocolHtml.includes('Any protocol change is logged here with its date and reason, and never applies retroactively to already-recorded trials.'),
    'change log must state the no-retroactivity rule');
  assert.ok(protocolHtml.includes('Insufficient data → no claim'),
    'protocol must carry the insufficient-data rule');
  assert.ok(protocolHtml.includes('states no claim rather than substituting or estimating'),
    'insufficient-data rule must forbid substitution and estimation');
  assert.ok(protocolHtml.includes('NO trial has run under this protocol yet — this protocol is not a trial and is not evidence.'),
    'not-a-trial banner must stay prominent');
});

test('Finding 1: landing nav links the Oracle page inside the nav block', () => {
  const navBlock = landingHtml.match(/<nav class="nav-links"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(navBlock, 'landing must have a nav-links block');
  assert.ok(navBlock[1].includes('href="oracle.html"'),
    'landing nav block must link oracle.html');
  assert.ok(navBlock[1].includes('>Oracle<'), 'landing nav link must be labelled Oracle');
});
