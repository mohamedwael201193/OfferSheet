// PROPOSED — NOT in any product tree. Written by worker w-test-adaptation
// (Track 1) to close the UNCOVERED / PARTIAL rows of COVERAGE.md in the
// same directory. To adopt: copy this file into the merge tree's test/
// directory (it then resolves ../frontend automatically) and run
// `node --test test/proposed-v3-gaps.test.js`.
// Layout resolution: when run from the merge tree's test/ dir it reads
// ../frontend; when run from this worker directory it reads the merge
// tree via a relative path. No absolute paths, no reads above the
// workspace, no network, no secrets. The OFFERSHEET_TREE env var, if
// set, overrides both (point it at a tree root that holds frontend/).
// Honesty: banned names below are assembled from fragments (the same
// pattern as v3-spec.test.js) so this file itself cannot trip the ban
// it enforces; the multiplier guard is likewise assembled, never typed
// as a claim. No competitor project name appears anywhere in this file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  ...(process.env.OFFERSHEET_TREE ? [process.env.OFFERSHEET_TREE] : []),
  path.join(here, '..', 'frontend'),
  path.join(here, '..', '..', '..', 'v3-merge', 'frontend'),
];
const FRONTEND = candidates.find((c) => existsSync(path.join(c, 'index.html')));
assert.ok(FRONTEND, `no tree found; set OFFERSHEET_TREE (tried: ${candidates.join(', ')})`);
const read = (name) => readFileSync(path.join(FRONTEND, name), 'utf8');
const landing = read('index.html');
const app = read('app.html');

const section = (html, id) => {
  const m = html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`));
  assert.ok(m, `page must contain #${id}`);
  return m[1];
};

test('gap 1: landing carries the flow, overlap, and season-arc SVGs', () => {
  const flow = section(landing, 'flow');
  const flowSvg = flow.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  assert.ok(flowSvg, '#flow must contain an SVG');
  assert.ok(flowSvg[0].includes('viewBox="0 0 900 120"'), 'flow SVG must be 900x120');
  assert.ok(flowSvg[0].includes('aria-label="Offer enters, Qloo evidence is checked, verdict comes out"'), 'flow SVG must carry its aria-label');
  const evidence = section(landing, 'evidence');
  assert.ok(evidence.includes('Overlap diagram'), 'evidence must caption the overlap diagram');
  const overlapSvg = evidence.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  assert.ok(overlapSvg, '#evidence must contain the overlap SVG');
  assert.ok(overlapSvg[0].includes('viewBox="0 0 900 190"'), 'overlap SVG must be 900x190');
  assert.ok(overlapSvg[0].includes('aria-label="Two overlapping circles: headliner audience and opener audience, shared audience in the overlap"'), 'overlap SVG must carry its aria-label');
  assert.ok(overlapSvg[0].includes('Headliner') && overlapSvg[0].includes('Opener') && overlapSvg[0].includes('shared audience'), 'overlap SVG must label both circles and the shared audience');
  const ledger = section(landing, 'ledger');
  assert.ok(ledger.includes('Season arc'), 'ledger must caption the season arc');
  const arcSvg = ledger.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  assert.ok(arcSvg, '#ledger must contain the season-arc SVG');
  assert.ok(arcSvg[0].includes('viewBox="0 0 900 120"'), 'season-arc SVG must be 900x120');
  assert.ok(arcSvg[0].includes('aria-label="Season arc: offer signed, show happens, attendance reported, settle measured against break-even"'), 'season-arc SVG must carry its aria-label');
  for (const label of ['Offer signed', 'Show happens', 'Attendance reported', 'Settle vs break-even']) {
    assert.ok(arcSvg[0].includes(label), `season arc must label the ${label} node`);
  }
  // Deliberately NOT asserted: that the overlap circles geometrically
  // intersect. That geometry is disputed (see COVERAGE.md §1.2); pin
  // presence and labels only until the geometry is fixed.
});

test('gap 2: proof strip, scoped to #evidence, carries exact hashes and a dash requestId per row', () => {
  const evidence = section(landing, 'evidence');
  const rows = [
    ['headliner tags', 'affa6e35', 'f7f93f7', 'affa6e35703be8f54ddeec84c42966a06093e94f21082f4cd446ada31f7f93f7'],
    ['opener candidates', 'ca25e61f', 'f5f3bc4b', 'ca25e61f063d761de30b8d2378b3fa94a15520e3f51f2d681fa78e98f5f3bc4b'],
    ['city audience areas', '300b8295', '1a53cfc', '300b829594a73e7e81960ee7a913b4e258610d8a1a70fe903fad57bff1a53cfc'],
  ];
  for (const [label, prefix, suffix, full] of rows) {
    const row = evidence.match(new RegExp(`<tr><td>${label}</td>([\\s\\S]*?)</tr>`));
    assert.ok(row, `proof strip must carry a ${label} row`);
    assert.ok(row[1].includes(`${prefix}…<b>${suffix}</b>`), `${label} row must render the truncated hash ${prefix}…${suffix}`);
    assert.ok(row[1].includes(`title="${full}"`), `${label} row must carry the full hash for replay`);
    assert.ok(row[1].includes('<td>—</td>'), `${label} row requestId must be exactly a dash, never invented`);
  }
  assert.ok(evidence.includes('Qloo returns no requestId on this path, so it is shown as “—”, never invented.'),
    'proof strip must explain why the requestId is a dash');
});

test('gap 3: recorded band carries the literal values and picks, in order', () => {
  const recorded = section(landing, 'recorded');
  const trials = [...recorded.matchAll(/<div class="trial">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  assert.equal(trials.length, 3, 'recorded band must hold exactly three trials');
  const expected = [
    ['2,084', 'Graph Olivia Rodrigo', 'Gut Clairo', 'Web Armani White'],
    ['2,084', 'Graph Carly Rae Jepsen', 'Gut Sabrina Carpenter', 'Web Def Leppard'],
    ['1,895', 'Graph King Princess', 'Gut Gracie Abrams', 'Web could not select'],
  ];
  trials.forEach((trial, i) => {
    assert.ok(trial.includes('Recorded · Trial'), `trial ${i + 1} must be labelled recorded`);
    for (const marker of expected[i]) assert.ok(trial.includes(marker), `trial ${i + 1} must show ${marker}`);
  });
});

test('gap 4: landing dashboard picture — sidebar, formstrip, verdict, evidence row, workspace strip', () => {
  const dashboard = section(landing, 'dashboard');
  const sideLinks = [...dashboard.matchAll(/href="app\.html#([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sideLinks, ['tool', 'verdict', 'evidence', 'workspace', 'ledger'],
    `pictured sidebar must be the five destinations in order, found ${sideLinks.join(', ')}`);
  const formstrip = dashboard.match(/<div class="formstrip">([\s\S]*?)<\/div>\s*<div class="verdict">/);
  assert.ok(formstrip, 'dashboard must carry a formstrip before the pictured verdict');
  const labels = [...formstrip[1].matchAll(/<label>([^<]+)<\/label>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Artist', 'City', 'Guarantee'], `formstrip labels must be Artist, City, Guarantee in order, found ${labels.join(', ')}`);
  assert.ok(formstrip[1].includes('>Run<'), 'formstrip must end in the Run action');
  const verdict = dashboard.match(/<div class="verdict">([\s\S]*?)<\/div>\s*<div class="evrow">/);
  assert.ok(verdict, 'dashboard must carry a pictured verdict block');
  assert.ok(verdict[1].includes('Billie Eilish · New York · Guarantee $250,000'), 'pictured verdict must name the offer');
  assert.ok(verdict[1].includes('Recorded example — receipts run, 29 Oct, 32.1s'), 'pictured verdict who-line must carry the reconcile suffix (never Trial 1)');
  assert.ok(verdict[1].includes('2,084 <small>tickets to break even</small>'), 'pictured verdict must show the number with its unit');
  assert.ok(verdict[1].includes('$250,000 ÷ $120 = 2,083.33 — <b>rounded up: 2,084</b>'), 'pictured verdict must repeat the formula with the ceil step');
  for (const chip of ['7 receipts', '6 of 7 core legs ok', 'Graph: Olivia Rodrigo', 'Gut: Finneas', 'Web: Armani White']) {
    assert.ok(verdict[1].includes(chip), `pictured verdict chips must include ${chip}`);
  }
  const evrow = dashboard.match(/<div class="evrow">([\s\S]*?)<\/div>\s*<div class="workstrip">/);
  assert.ok(evrow, 'dashboard must carry a pictured evidence row');
  assert.deepEqual([...evrow[1].matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Headliner', 'Opener', 'City'],
    'evidence row minis must be Headliner, Opener, City in order');
  const workstrip = dashboard.match(/<div class="workstrip">([\s\S]*?)<\/div>/);
  assert.ok(workstrip, 'dashboard must carry a pictured workspace strip');
  assert.ok(workstrip[1].includes('Workspace — routing'), 'workspace strip must be headed routing');
  assert.ok(workstrip[1].includes('Base city New York (40.7127, -74.0060)'), 'workspace strip must carry the base-city routing coordinates verbatim');
  assert.ok(workstrip[1].includes('candidate Los Angeles (34.0537, -118.2428)'), 'workspace strip must carry the candidate-city routing coordinates verbatim');
  assert.ok(workstrip[1].includes('Comparison holds up to 5 offers with no winner badge'), 'workspace strip must state the comparison limit with no winner badge');
});

test('gap 5: app verdict card structure — hidden card holding number, unit, and verdict line', () => {
  const verdict = app.match(/<section[^>]*id="verdict"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(verdict, 'app must contain a #verdict section');
  assert.ok(/<section[^>]*id="verdict"[^>]*hidden/.test(app), 'verdict card must be hidden until a verdict runs');
  assert.ok(verdict[1].includes('<span id="beTickets"'), 'verdict card must hold the break-even number slot');
  assert.ok(verdict[1].includes('<span class="verdict-unit">tickets to break even</span>'), 'verdict card must hold the unit label beside the number');
  assert.ok(verdict[1].includes('<p id="beVerdict"'), 'verdict card must hold the verdict line');
});

test('gap 6: ledger, scoped to #ledger, shows the empty-settle state and no settled figure', () => {
  const ledger = section(landing, 'ledger');
  assert.ok(ledger.includes('<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>'),
    'ledger table must show one all-dash empty row');
  assert.ok(ledger.includes('No show has settled yet — the settle ledger is empty, and no settled figure is claimed anywhere.'),
    'ledger must carry the empty-settle sentence verbatim');
  assert.ok(!ledger.includes('settled: $') && !ledger.includes('Settled at'),
    'ledger must not invent a settled figure');
});

test('gap 7: phone static verdict pairs the number with its unit inside the screen', () => {
  const phone = landing.slice(landing.indexOf('id="get-the-app"'));
  const screen = phone.match(/<div class="ms-screen">([\s\S]*?)<\/div>\s*<span class="ms-homebar"/);
  assert.ok(screen, 'phone must contain a screen above the home bar');
  assert.ok(screen[1].includes('<p class="record-verdict-num">2,084</p>'),
    'phone screen must show the recorded verdict number 2,084 on its own element');
  assert.ok(screen[1].includes('<p class="record-verdict-label">tickets to break even</p>'),
    'phone screen must pair the number with the tickets-to-break-even label');
  assert.ok(screen[1].includes('Recorded demo — 29 Oct 2026 trial, not a live verdict'),
    'phone screen must carry the persistent recorded label');
});

test('gap 8: blanket honesty guard — no best-offer or recommended-offer claim anywhere', () => {
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    assert.ok(!/best offer/i.test(html), `${name} must not claim a best offer in any wording`);
    assert.ok(!/recommended offer/i.test(html), `${name} must not recommend an offer in any wording`);
    // Multiplier guard, assembled so this file states no multiplier claim.
    const mult = new RegExp('5' + 'x' + '|' + '5' + '×' + '|\\d+\\s*times better', 'i');
    assert.ok(!mult.test(html), `${name} must not carry a multiplier claim`);
  }
  // Banned-name guard, assembled from fragments (same pattern as
  // v3-spec.test.js) so this file cannot trip the ban it enforces.
  const BANNED = ['join' + 'mita', 'lapa.' + 'ninja', 'kur' + 'ate'];
  for (const banned of BANNED) {
    assert.ok(!landing.toLowerCase().includes(banned), `landing must not contain a banned name`);
    assert.ok(!app.toLowerCase().includes(banned), `app must not contain a banned name`);
  }
});
