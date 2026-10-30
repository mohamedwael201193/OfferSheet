// MERGE (P2 checklist): data-bound formula diagram, frontend-only.
// Pattern: slice app.js up to submitVerdict, run in node:vm against a
// minimal fake document — exactly like test/ship-items.test.js.
// The verdict under test is the REAL recorded fixture captured by the
// coordinator (phase3-evidence/live-verdict-billie.json); derived test
// inputs below are that fixture with break-even fields toggled, and are
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
const APP_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'app.html'), 'utf8');
const SLICE = APP_JS.slice(0, APP_JS.indexOf('async function submitVerdict'));
const LIVE = JSON.parse(fs.readFileSync((fs.existsSync(path.join(__dirname, '..', 'phase3-evidence', 'live-verdict-billie.json'))
    ? path.join(__dirname, '..', 'phase3-evidence', 'live-verdict-billie.json')
    : path.join(__dirname, '..', '..', 'phase3-evidence', 'live-verdict-billie.json')), 'utf8'));

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

// Static: the 12 diagram ids exist in app.html, and the static formula
// figure is gone (its ids must not appear anywhere).
test('diagram: all 12 diagram ids exist in app.html; static figure ids gone', () => {
  for (const id of ['formulaDiagram', 'diagramGuarantee', 'diagramNet', 'diagramNetBuild', 'diagramQuotient', 'diagramCeil', 'diagramLive', 'diagramFallback', 'checkGuarantee', 'checkPrice', 'checkCost', 'checkResult']) {
    assert.ok(APP_HTML.includes(`id="${id}"`), `app.html must contain ${id}`);
  }
  assert.doesNotMatch(APP_HTML, /id="formulaImg"/);
  assert.doesNotMatch(APP_HTML, /id="formulaFallback"/);
  assert.match(APP_HTML, /Recorded example — from the recorded trials, not this run/);
});

// Live: the recorded Billie fixture (guarantee 250000, net 120, no cost
// entered) fills every span; the live block shows, the fallback hides.
test('diagram: recorded verdict fills every span; live shows, fallback hides', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  assert.equal(get('diagramGuarantee').textContent, '$250,000');
  assert.equal(get('diagramNet').textContent, '$120');
  assert.equal(get('diagramNetBuild').textContent, '$120 per ticket — no variable cost entered, net is before variable costs');
  assert.equal(get('diagramQuotient').textContent, '2,083.33');
  assert.equal(get('diagramCeil').textContent, '2,084 tickets');
  assert.equal(get('diagramLive').hidden, false);
  assert.equal(get('diagramFallback').hidden, true);
});

// Derived test input (NOT a recorded run): cost entered.
test('diagram: provided cost builds the net line from price minus cost', () => {
  const { sandbox, get } = loadApp();
  const v = structuredClone(LIVE);
  v.breakEven.price = { value: 120, source: 'user-supplied' };
  v.breakEven.variableCost = { value: 20, provided: true };
  v.breakEven.net = 100;
  v.breakEven.tickets = 2500;
  sandbox.renderVerdict(v, false);
  assert.equal(get('diagramNet').textContent, '$100');
  assert.equal(get('diagramNetBuild').textContent, '$120 − $20 per ticket');
  assert.equal(get('diagramQuotient').textContent, '2,500.00');
  assert.equal(get('diagramCeil').textContent, '2,500 tickets');
});

// Derived test input (NOT a recorded run): net zero — quotient dashes,
// ticket count still the verdict's own number.
test('diagram: net zero or negative dashes the quotient, keeps the count', () => {
  const { sandbox, get } = loadApp();
  const v = structuredClone(LIVE);
  v.breakEven.net = 0;
  sandbox.renderVerdict(v, false);
  assert.equal(get('diagramQuotient').textContent, '—');
  assert.equal(get('diagramCeil').textContent, '2,084 tickets');
});

// Reset: after a verdict, hideVerdict returns the diagram to dashes plus
// the labelled recorded fallback — no stale live figures linger.
test('diagram: hideVerdict resets spans and restores the fallback', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  assert.equal(get('diagramCeil').textContent, '2,084 tickets');
  sandbox.hideVerdict();
  for (const id of ['diagramGuarantee', 'diagramNet', 'diagramNetBuild', 'diagramQuotient', 'diagramCeil']) {
    assert.equal(get(id).textContent, '—', `${id} must reset to a dash`);
  }
  assert.equal(get('diagramLive').hidden, true);
  assert.equal(get('diagramFallback').hidden, false);
});

// Static: renderDiagram is wired into renderVerdict and hideVerdict.
test('diagram: app.js wires renderDiagram into renderVerdict and hideVerdict', () => {
  assert.match(APP_JS, /function renderDiagram\(v\)/);
  assert.match(APP_JS, /renderDiagram\(v\);/);
  assert.match(APP_JS, /diagramLive.*hidden = true/);
  assert.match(APP_JS, /diagramFallback.*hidden = false/);
});
