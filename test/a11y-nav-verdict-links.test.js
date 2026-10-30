// M1 (second round, blocker B-J2-1): the four app-nav links to
// still-hidden verdict sections were dead jumps pre-run — the anchor
// glue only opens <details>/disc ancestors and never unhides, so a
// keyboard user following one pre-run landed nowhere with no
// feedback. Fix: the links render inert-but-explained pre-run
// (aria-disabled + "appears after a verdict runs" title/aria-label,
// jump cancelled by the app.html glue) and go live exactly when
// their section becomes visible, derived from the section's own
// hidden flag — never by unhiding empty sections.
//
// Pattern: static app.html/app.js presence pins + a vm slice of
// app.js up to submitVerdict against a minimal fake document —
// exactly like test/g-items-frontend.test.js — driven by the REAL
// recorded fixture (phase3-evidence/live-verdict-billie.json).
// The skip-link retarget (the leg of M1 that was already fixed)
// is pinned unchanged alongside, so this fix cannot regress it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APP_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'app.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'app.js'), 'utf8');
const SLICE = APP_JS.slice(0, APP_JS.indexOf('async function submitVerdict'));
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'phase3-evidence', 'live-verdict-billie.json'), 'utf8'));

const EXPLAIN = 'appears after a verdict runs';
const NAV_TARGETS = [
  ['verdict', 'Verdict'],
  ['receiptSection', 'Receipts'],
  ['verdictSheet', 'Sheet'],
  ['raceSection', 'Race'],
];

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const navBlock = () => {
  const m = stripComments(APP_HTML).match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(m, 'app.html must contain one <nav>');
  return m[1];
};
const anchorsIn = (block) => [...block.matchAll(/<a\b([^>]*)>/g)].map((m) => m[1]);
const attrOf = (tagAttrs, name) => {
  const m = tagAttrs.match(new RegExp(`${name}="([^"]*)"`)) || tagAttrs.match(new RegExp(`${name}='([^']*)'`));
  return m ? m[1] : null;
};
const sectionTag = (id) => {
  const m = APP_HTML.match(new RegExp(`<section[^>]*id="${id}"[^>]*>`));
  assert.ok(m, `app.html must contain a section #${id}`);
  return m[0];
};

test('M1 pre-run (static): the four nav links are inert-but-explained', () => {
  const nav = navBlock();
  for (const [id, label] of NAV_TARGETS) {
    const tag = anchorsIn(nav).find((a) => attrOf(a, 'href') === `#${id}`);
    assert.ok(tag, `nav must contain a link to #${id}`);
    assert.equal(attrOf(tag, 'aria-disabled'), 'true', `#${id} nav link must be aria-disabled pre-run`);
    assert.equal(attrOf(tag, 'title'), `Appears after a verdict runs`, `#${id} nav link must explain itself in title`);
    assert.equal(attrOf(tag, 'aria-label'), `${label} — ${EXPLAIN}`, `#${id} nav link must explain itself in aria-label`);
  }
});

test('M1 pre-run (static): the four sections are NOT unhidden to fix this', () => {
  for (const [id] of NAV_TARGETS) {
    assert.ok(/\bhidden\b/.test(sectionTag(id)), `#${id} must still carry hidden pre-run (no empty-section unhide)`);
  }
});

test('M1 pre-run (static): no duplicate verdict links survive the sidebar consolidation', () => {
  // SUPERSEDED BY DESIGN 6 (sidebar consolidation, judged batch):
  // the floating glass toolbar this test used to pin is REMOVED —
  // its Receipts/Sheet duplicates no longer exist, so "duplicates
  // share the same state" becomes the STRICTER "no duplicates exist
  // at all": exactly one link per verdict target in the whole page,
  // and that single copy is the inert-but-explained sidebar link.
  // (The sidebar pinning test independently pins the same contract.)
  assert.ok(!APP_HTML.includes('glass-toolbar'), 'the floating glass toolbar must be gone after the sidebar consolidation');
  const page = stripComments(APP_HTML);
  for (const [id, label] of [['receiptSection', 'Receipts'], ['verdictSheet', 'Sheet']]) {
    const copies = anchorsIn(page).filter((a) => attrOf(a, 'href') === `#${id}`);
    assert.equal(copies.length, 1, `#${id} must have exactly one link on the page (no toolbar duplicate)`);
    assert.equal(attrOf(copies[0], 'aria-disabled'), 'true', `the single #${id} link must be aria-disabled pre-run`);
    assert.equal(attrOf(copies[0], 'aria-label'), `${label} — ${EXPLAIN}`);
  }
});

test('M1 (static): disabled-link jumps are cancelled in the glue, before openAncestors', () => {
  const glue = APP_HTML;
  const intercept = glue.indexOf(`closest('a[aria-disabled="true"]')`);
  assert.ok(intercept >= 0, 'glue must intercept clicks on aria-disabled links');
  assert.ok(glue.includes('preventDefault'), 'glue must preventDefault the disabled jump');
  const openAncestors = glue.indexOf('openAncestors(document.getElementById(id))');
  assert.ok(openAncestors > intercept, 'intercept listener must be registered before the openAncestors listener');
});

test('M1 (static): sync sites mirror the skip-link sites (render + hide + load)', () => {
  assert.ok(APP_JS.includes('function setVerdictNavState()'), 'app.js must define setVerdictNavState');
  // hideVerdict revert site: the sync call follows the sheet hide.
  assert.match(APP_JS, /sheet\.hidden = true;\s*\/\/ M1[\s\S]*?setVerdictNavState\(\)/, 'hideVerdict must re-sync after hiding');
  // G5 render site: the sync call follows the skip-link retarget.
  assert.match(APP_JS, /skip\.href = '#verdict'[\s\S]*?setVerdictNavState\(\)/, 'renderVerdict G5 site must sync after the skip retarget');
  // Skip-link legs themselves are untouched by this fix.
  assert.ok(APP_JS.includes("skip.href = '#tool'"), 'hideVerdict skip revert to #tool must survive');
  assert.ok(APP_JS.includes("skip.href = '#verdict'"), 'G5 skip retarget to #verdict must survive');
});

// ---- vm harness (g-items-frontend pattern, extended with attributes) ----
function makeEl(id) {
  const el = {
    id, hidden: false, textContent: '', className: '', value: '', dataset: {},
    open: false, onclick: null, style: { setProperty(k, v) { this[k] = v; } },
    _attrs: {},
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; },
    setAttribute(name, v) { this._attrs[name] = String(v); },
    removeAttribute(name) { delete this._attrs[name]; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name); },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    children: [],
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    scrollIntoView() {}, focus() {}, addEventListener() {},
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ''; },
  };
  return el;
}

function makeAnchor(href, text) {
  const a = makeEl(null);
  a.setAttribute('href', href);
  a.href = href;
  a.textContent = text;
  return a;
}

function loadApp() {
  const els = new Map();
  const doc = {
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement(tag) { const el = makeEl(null); el.tagName = tag; return el; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  // Nav + toolbar containers: the ONLY scopes setVerdictNavState touches.
  const navAnchors = NAV_TARGETS.map(([id, label]) => makeAnchor(`#${id}`, label));
  const barAnchors = [makeAnchor('#receiptSection', 'Receipts'), makeAnchor('#verdictSheet', 'Sheet')];
  const navEl = makeEl('appNav');
  navEl.querySelectorAll = () => navAnchors;
  navEl.querySelector = (sel) => navAnchors.find((a) => sel.includes(a.getAttribute('href'))) || null;
  const barEl = makeEl(null);
  barEl.querySelectorAll = () => barAnchors;
  barEl.querySelector = () => null;
  doc.querySelector = (sel) => {
    if (sel === '#appNav' || sel === '.nav-links') return navEl;
    if (sel === '.glass-toolbar') return barEl;
    return null;
  };
  const sandbox = {
    document: doc,
    window: { matchMedia: () => ({ matches: true }), print: () => {} },
    navigator: {},
    console,
    setTimeout: () => {},
  };
  sandbox.window.document = doc;
  vm.createContext(sandbox);
  vm.runInContext(SLICE, sandbox);
  // Pre-run: all four sections hidden, exactly as app.html ships them.
  for (const [id] of NAV_TARGETS) doc.getElementById(id).hidden = true;
  const anchors = { nav: navAnchors, bar: barAnchors };
  const anchorFor = (list, id) => list.find((a) => a.getAttribute('href') === `#${id}`);
  return { sandbox, get: (id) => doc.getElementById(id), anchors, anchorFor };
}

const assertInert = (a, label) => {
  assert.equal(a.getAttribute('aria-disabled'), 'true', `${label} must be aria-disabled`);
  assert.equal(a.getAttribute('title'), 'Appears after a verdict runs', `${label} must carry the explanation in title`);
  assert.equal(a.getAttribute('aria-label'), `${label} — ${EXPLAIN}`, `${label} must carry the explanation in aria-label`);
};
const assertLive = (a, label) => {
  assert.equal(a.getAttribute('aria-disabled'), null, `${label} must be live (no aria-disabled)`);
  assert.equal(a.getAttribute('title'), null, `${label} must drop the pre-run title when live`);
  assert.equal(a.getAttribute('aria-label'), null, `${label} must drop the pre-run aria-label when live`);
};

test('M1 (dynamic): pre-run sync makes all nav + toolbar verdict links inert', () => {
  const { sandbox, anchors, anchorFor } = loadApp();
  sandbox.setVerdictNavState();
  for (const [id, label] of NAV_TARGETS) assertInert(anchorFor(anchors.nav, id), label);
  for (const [id, label] of [['receiptSection', 'Receipts'], ['verdictSheet', 'Sheet']]) assertInert(anchorFor(anchors.bar, id), label);
});

test('M1 (dynamic): no-race verdict makes Verdict/Receipts/Sheet live, Race stays inert', () => {
  const { sandbox, get, anchors, anchorFor } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  assert.equal(get('raceSection').hidden, true, 'no-race render must keep raceSection hidden');
  for (const [id, label] of [['verdict', 'Verdict'], ['receiptSection', 'Receipts'], ['verdictSheet', 'Sheet']]) {
    assert.equal(get(id).hidden, false, `#${id} must be visible after a verdict`);
    assertLive(anchorFor(anchors.nav, id), label);
  }
  assertInert(anchorFor(anchors.nav, 'raceSection'), 'Race');
  // The verdict-card jump link is NOT a nav link: sync must not rewrite it.
  const jump = get('verdict').children.find((c) => c.id === 'verdictJumpLink');
  assert.ok(jump, 'verdict-card jump link must render');
  const jumpA = jump.children[0];
  assert.equal(jumpA.getAttribute('aria-disabled'), null, 'jump link must not gain aria-disabled');
  assert.equal(jumpA.getAttribute('aria-label'), null, 'jump link must keep its own accessible name');
});

test('M1 (dynamic): race verdict makes Race live too', () => {
  const { sandbox, get, anchors, anchorFor } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), true);
  assert.equal(get('raceSection').hidden, false, 'race render must show raceSection');
  assertLive(anchorFor(anchors.nav, 'raceSection'), 'Race');
});

test('M1 (dynamic): hideVerdict reverts every link to inert-but-explained', () => {
  const { sandbox, anchors, anchorFor } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), true);
  assertLive(anchorFor(anchors.nav, 'raceSection'), 'Race');
  sandbox.hideVerdict();
  for (const [id, label] of NAV_TARGETS) assertInert(anchorFor(anchors.nav, id), label);
  for (const [id, label] of [['receiptSection', 'Receipts'], ['verdictSheet', 'Sheet']]) assertInert(anchorFor(anchors.bar, id), label);
});
