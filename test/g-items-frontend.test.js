// G5/G8/G9/G10/G11/G12/G13 (superiority), frontend-only.
// Pattern: slice app.js up to submitVerdict, run in node:vm against a
// minimal fake document — exactly like test/phase3-verdict.test.js.
// The verdict under test is the REAL recorded fixture captured by the
// coordinator (phase3-evidence/live-verdict-billie.json).
// G7 (skip link) and the G12 load-time prefill live OUTSIDE the slice
// (called at the init block), so they are covered by static app.js
// presence tests below + live judge, never claimed as shim-tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'app.js'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'), 'utf8');
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

// LIVE fixture leg states: ok 6 (findTags, describe, recommend,
// wherePopular, demographics, entityTags), empty 3 (rank, trends,
// compare), error 4 (restSearch, restInsights, restCompare, restEntities).
const LEGS_LINE = 'Live legs this run: 6 ok · 3 empty · 4 error.';

test('G11: badge is state-derived (6/7 core legs ok on the LIVE fixture)', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  assert.equal(get('qlooBadge').textContent, 'Qloo live · 6/7 core legs ok');
  assert.match(get('qlooBadge').className, /green/);
});

test('G11: sheet and brief carry the same code-filled legs line', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  assert.match(get('sheetBody').innerHTML, new RegExp(LEGS_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(sandbox.sheetBriefText(structuredClone(LIVE)), new RegExp(LEGS_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('G8: step-log lead line carries the truncated hash + requestId per receipt', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  const logs = get('receiptList').children.map((c) => decodeHtml(c.innerHTML));
  assert.ok(logs.length > 0, 'step logs must render');
  const first = LIVE.receipts[0];
  const shortHash = String(first.requestHash).slice(0, 12);
  assert.ok(logs.some((h) => h.includes(`hash ${shortHash}`)), 'lead line must show the truncated hash');
  assert.ok(logs.every((h) => h.includes('requestId')), 'every step log must carry the lead line');
});

test('G5: verdict auto-reveal scrolls instantly under reduced-motion and focuses', () => {
  const { sandbox, get } = loadApp();
  const verdictEl = get('verdict');
  const scrolled = [];
  const focused = [];
  verdictEl.scrollIntoView = (opts) => scrolled.push(opts);
  verdictEl.focus = (opts) => focused.push(opts);
  sandbox.renderVerdict(structuredClone(LIVE), false);
  // The shim's matchMedia returns matches:true, so reduced-motion applies.
  assert.equal(scrolled.length, 1);
  assert.equal(scrolled[0].behavior, 'auto');
  assert.equal(scrolled[0].block, 'start');
  assert.equal(focused.length, 1);
  assert.equal(focused[0].preventScroll, true);
});

test('G9/G10/G13: jump link, export rail, and how-made summary render on verdict', () => {
  const { sandbox, get } = loadApp();
  sandbox.renderVerdict(structuredClone(LIVE), false);
  const verdictKids = get('verdict').children;
  const jump = verdictKids.find((c) => c.id === 'verdictJumpLink');
  assert.ok(jump, 'verdict-card jump link must render');
  assert.equal(jump.children[0].href, '#receiptSection');
  const rail = verdictKids.find((c) => c.id === 'exportRail');
  assert.ok(rail, 'export rail must render');
  const labels = rail.children.filter((c) => c.tagName === 'button').map((b) => b.textContent);
  assert.deepEqual(labels, ['Proof pack (JSON)', 'Verdict CSV', 'Print sheet', 'Copy brief', 'Copy share link']);
  assert.ok(rail.children.every((c) => typeof c.onclick === 'function' || c.tagName === 'span'), 'every rail button must be wired');
  const how = verdictKids.find((c) => c.id === 'howMade');
  assert.ok(how, 'how-made summary must render');
  assert.equal(how.children[0].textContent, 'How this verdict was made');
  assert.equal(how.children[1].children.length, Object.keys(LIVE.legs).length, 'how-made must list every leg present');
});

test('G12: share URL builder uses inputs only — never a verdict number', () => {
  const { sandbox } = loadApp();
  const url = sandbox.buildShareUrl('https://offersheet-rouge.vercel.app', '/app.html', {
    artist: 'Billie Eilish', city: 'New York', venue: '', guarantee: 250000,
    ticketPrice: 120, variableCost: '', capacity: '',
  });
  assert.equal(url, 'https://offersheet-rouge.vercel.app/app.html?artist=Billie%20Eilish&city=New%20York&guarantee=250000&ticketPrice=120');
  assert.doesNotMatch(url, /tickets|breakEven|2084/);
  const empty = sandbox.buildShareUrl('https://x.example', '/app.html', {});
  assert.equal(empty, 'https://x.example/app.html?');
});

test('G7/G12 (static): skip link creation + inputs-only prefill exist in app.js, with no auto-submit', () => {
  assert.match(APP_JS, /className = 'skip-link'/);
  assert.match(APP_JS, /href = '#verdict'/);
  assert.match(APP_JS, /textContent = 'Skip to verdict'/);
  assert.match(APP_JS, /wirePageAids\(\)/);
  // Prefill sets form fields from URL params; it must never submit.
  const prefill = APP_JS.slice(APP_JS.indexOf('function wirePageAids'));
  assert.match(prefill, /new URLSearchParams\(loc\.search\)/);
  assert.doesNotMatch(prefill, /submitVerdict/);
});

test('G5/G7/G9/G10/G13 (static): aids styles exist in styles.css', () => {
  for (const cls of ['.skip-link', '.step-lead', '.verdict-jump', '.export-rail', '.share-note', '.how-made']) {
    assert.ok(STYLES_CSS.includes(cls), `styles.css must define ${cls}`);
  }
  assert.match(STYLES_CSS, /\.skip-link:focus/);
});
