// Redesign W1 (app page): one nav, footer contrast repair.
// The app page previously carried TWO <nav> landmarks (header nav +
// proof index) duplicating four targets, and a dark-band footer whose
// links rendered ink-on-ink (invisible). This file pins the fix. It
// asserts markup and CSS rules only — it does not run a browser — so
// the 390px overflow claim is stated by its method: the footer band
// clips horizontally and no footer rule sets a fixed wide width, with
// the mobile rule capping footer paragraphs at 100%.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = readFileSync(fileURLToPath(new URL('../frontend/app.html', import.meta.url)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('../frontend/app.js', import.meta.url)), 'utf8');
const dashboard = readFileSync(fileURLToPath(new URL('../frontend/dashboard.css', import.meta.url)), 'utf8');
const styles = readFileSync(fileURLToPath(new URL('../frontend/styles.css', import.meta.url)), 'utf8');

const idsOf = (html) => new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const navBlocks = [...app.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)];

test('app page has exactly one <nav>, with the old proof-index nav folded in', () => {
  assert.equal(navBlocks.length, 1, `app.html must contain exactly one <nav>, found ${navBlocks.length}`);
  assert.ok(!app.includes('class="proof-index'), 'no second proof-index nav element may remain');
  assert.ok(navBlocks[0][0].includes('class="nav-links'), 'the single nav keeps the .nav-links class app.js queries');
  assert.ok(navBlocks[0][0].includes('aria-label="App sections"'), 'the single nav keeps its landmark label');
});

test('every single-nav href resolves, each in-page target exactly once', () => {
  const ids = idsOf(app);
  const hrefs = [...navBlocks[0][1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const inPage = hrefs.filter((h) => h.startsWith('#'));
  assert.equal(new Set(inPage).size, inPage.length, `nav in-page targets must not repeat: ${inPage}`);
  for (const h of inPage) {
    assert.ok(ids.has(h.slice(1)), `nav href ${h} must resolve to an existing id`);
  }
  for (const h of hrefs.filter((x) => !x.startsWith('#'))) {
    const file = h.split('#')[0];
    assert.ok(existsSync(fileURLToPath(new URL(`../frontend/${file}`, import.meta.url))),
      `nav href ${h} must resolve to an existing frontend file`);
  }
});

test('single nav keeps every required jump target, including Receipts', () => {
  const body = navBlocks[0][1];
  for (const h of ['#tool', '#verdict', '#formula', '#depth', '#workspace', '#ledger',
    '#receiptSection', '#verdictSheet', '#raceSection', '#trialTally', '#limits',
    'oracle.html', 'index.html']) {
    assert.ok(body.includes(`href="${h}"`), `single nav must keep ${h}`);
  }
});

test('keyboard path survives: skip link injected first, verdict target exists, glue script intact', () => {
  assert.match(appJs, /className = 'skip-link'/, 'app.js must still inject the skip link');
  assert.match(appJs, /href = '#verdict'/, 'skip link must still target #verdict');
  assert.ok(idsOf(app).has('verdict'), 'skip-link target #verdict must exist');
  assert.ok(app.includes('openAncestors'), 'disc glue script must still open collapsed ancestors on anchor jumps');
  assert.ok(app.includes("a[href^=\"#\"]"), 'glue script must still listen to in-page anchors');
  assert.match(dashboard, /\.skip-link:focus/, 'skip-link focus rule must still exist');
});

test('footer content is verbatim: no-results note, links, tagline, colophon', () => {
  const footer = app.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)[1];
  assert.ok(footer.includes('What results do NOT establish'), 'footer must keep the no-results-establish note');
  assert.ok(footer.includes('one money decision, before you sign'), 'footer must keep the tagline');
  assert.ok(footer.includes('Colophon'), 'footer must keep the colophon');
  for (const h of ['docs.html', 'tools.html', 'index.html', 'oracle.html']) {
    assert.ok(footer.includes(`href="${h}"`), `footer must keep its ${h} link`);
  }
});

test('footer is readable on the dark band: light text and light links, both stylesheets', () => {
  for (const [name, css] of [['dashboard.css', dashboard], ['styles.css', styles]]) {
    assert.match(css, /\.footer\.band--deep p[^}]*color:\s*var\(--color-paper-2\)/,
      `${name} must set dark-band footer paragraphs to paper-2`);
    assert.match(css, /\.footer\.band--deep a[^}]*color:\s*var\(--color-paper-hi\)/,
      `${name} must set dark-band footer links to paper-hi (the old ink-on-ink defect)`);
  }
});

test('footer cannot overflow at 390px (CSS-rule method, stated honestly)', () => {
  // Method: no browser runs in this suite, so this asserts the CSS
  // facts that prevent overflow — band clips horizontally, footer
  // paragraphs cap at 100% on mobile — rather than a measured width.
  assert.match(dashboard, /\.footer\.band--deep\s*\{[^}]*overflow-x:\s*clip/,
    'dashboard footer band must clip horizontally');
  assert.match(dashboard, /\.footer\.band--deep p\s*\{[^}]*max-width:\s*100%/,
    'dashboard mobile footer paragraphs must cap at 100% width');
  const footerLines = dashboard.split('\n').filter((l) => l.includes('footer') || l.includes('.footer'));
  for (const line of footerLines) {
    assert.doesNotMatch(line, /width:\s*(?:[4-9]\d\d|\d{4,})px/,
      `no footer rule may set a fixed width >= 400px: ${line.trim()}`);
  }
});

test('redesign motion is killed under prefers-reduced-motion', () => {
  const reduced = dashboard.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]*$/)[0];
  assert.ok(reduced.includes('.app-rule'), 'reduced-motion block must cover the hairline rule animation');
  assert.ok(reduced.includes('.nav-links a::after'), 'reduced-motion block must cover the nav underline slide');
  assert.ok(app.includes('class="app-rule"'), 'hairline rule divider must exist in app.html');
  assert.ok(app.includes('aria-hidden="true"><svg'), 'hairline divider must be decorative (aria-hidden svg)');
});
