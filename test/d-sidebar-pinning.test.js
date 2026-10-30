// D-SIDEBAR pinning test — dashboard sidebar consolidation batch.
// Static assertions only (no browser): one sidebar nav, no top header
// bar, no floating toolbar, all jump targets preserved, skip link +
// keyboard path intact, four verdict links inert-but-explained
// pre-run and live only for sections that are actually visible.
// Resolves the frontend under test from either location: when copied
// into a candidate tree's test/ dir it reads ../frontend/*; when run
// standalone from this scratch dir it reads ./*.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pick = (...cands) => cands.find((c) => existsSync(c));
const htmlPath = pick(join(here, 'frontend', 'app.html'), join(here, '..', 'frontend', 'app.html'), join(here, 'app.html'));
const cssPath = pick(join(here, 'frontend', 'dashboard.css'), join(here, '..', 'frontend', 'dashboard.css'), join(here, 'dashboard.css'));
const jsPath = pick(join(here, 'frontend', 'app.js'), join(here, '..', 'frontend', 'app.js'), join(here, 'app.js'));
const pristinePath = pick(join(here, 'app.html.pristine'), join(here, '..', 'd-sidebar', 'app.html.pristine'));
const html = readFileSync(htmlPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const js = readFileSync(jsPath, 'utf8');
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const navBlocks = [...stripComments(html).matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)];
const rawNavBlocks = [...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)];
const idsOf = (s) => new Set([...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const VERDICT_LINKS = ['#verdict', '#receiptSection', '#verdictSheet', '#raceSection'];

test('exactly one nav on the dashboard page, and it is the sidebar nav', () => {
  assert.equal(navBlocks.length, 1, `must contain exactly one nav, found ${navBlocks.length}`);
  assert.equal(rawNavBlocks.length, 1, 'raw count must also be 1 (no nav-like string smuggled in a comment)');
  assert.ok(navBlocks[0][0].includes('id="appNav"'), 'the single nav keeps id appNav');
  assert.ok(navBlocks[0][0].includes('class="nav-links'), 'the single nav keeps the .nav-links class');
  assert.ok(navBlocks[0][0].includes('aria-label="App sections"'), 'the single nav keeps its landmark label');
  assert.ok(html.includes('<div class="sidebar-panel"'), 'sidebar panel wrapper must exist');
  const panel = html.slice(html.indexOf('<div class="sidebar-panel"'), html.indexOf('<div class="app-shell"'));
  assert.ok(panel.includes('<nav'), 'the nav must live inside the sidebar panel');
});

test('top header bar and floating toolbar are gone, their contents moved to the panel', () => {
  assert.ok(!html.includes('<header'), 'no header element may remain');
  assert.ok(!html.includes('glass-toolbar'), 'no floating toolbar markup may remain');
  assert.ok(!html.includes('class="nav proof appbar"'), 'no top appbar element may remain');
  assert.ok(!html.includes('nav-inner'), 'no header inner wrapper may remain');
  const panel = html.slice(html.indexOf('<div class="sidebar-panel"'), html.indexOf('<div class="app-shell"'));
  assert.ok(panel.includes('id="qlooBadge"'), 'status badge must move into the sidebar panel');
  assert.ok(panel.includes('OfferSheet'), 'wordmark must move into the sidebar panel');
  assert.ok(/class="[^"]*\bbtn\b[^"]*\bnav-cta\b|class="[^"]*\bnav-cta\b[^"]*\bbtn\b/.test(panel), 'primary CTA must stay a .btn .nav-cta in the panel');
  assert.ok(panel.includes('sidebar-run'), 'Run-the-verdict button must move into the sidebar panel');
  assert.ok(panel.includes('form="offerForm"'), 'sidebar Run button must still submit offerForm');
});

test('nav target inventory: every previous target kept exactly once, resolving to a real id', () => {
  const body = navBlocks[0][1];
  const ids = idsOf(html);
  const hrefs = [...body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const inPage = hrefs.filter((h) => h.startsWith('#'));
  assert.equal(new Set(inPage).size, inPage.length, `nav in-page targets must not repeat: ${inPage}`);
  for (const h of ['#tool', '#verdict', '#evidence', '#formula', '#depth', '#workspace', '#ledger',
    '#receiptSection', '#verdictSheet', '#raceSection', '#trialTally', '#limits',
    'oracle.html', 'index.html']) {
    assert.ok(body.includes(`href="${h}"`), `single nav must keep ${h}`);
  }
  for (const h of inPage) assert.ok(ids.has(h.slice(1)), `nav href ${h} must resolve to an existing id`);
});

test('no jump target was renamed', () => {
  if (!pristinePath) { test.skip('pristine copy not present in this layout'); return; }
  const before = idsOf(readFileSync(pristinePath, 'utf8'));
  const after = idsOf(html);
  const dropped = [...before].filter((id) => !after.has(id));
  // Additive-only allowlist: the panel wrapper + the two verdict-nav
  // explanation elements are new ids, not renames — no previous id
  // may be dropped and no other id may appear.
  const allowedAdditions = new Set(['sidebarPanel', 'verdictNavNote', 'verdictNavStatus']);
  const added = [...after].filter((id) => !before.has(id) && !allowedAdditions.has(id));
  assert.deepEqual(dropped, [], `no id may be dropped: ${dropped}`);
  assert.deepEqual(added, [], `no id may be added/renamed beyond the allowlist: ${added}`);
});

test('qualified receipt heading wording preserved', () => {
  assert.ok(html.includes('Proof for every evidence claim (click to re-check)'),
    'receipt heading wording must survive untouched');
});

test('skip link + keyboard path survive the consolidation', () => {
  assert.match(js, /className = 'skip-link'/, 'app.js must still inject the skip link');
  assert.ok(js.includes("body.insertBefore(a, body.firstChild)"), 'skip link must still be injected first in body');
  assert.match(js, /href = '#verdict'/, 'skip link must still retarget to #verdict');
  assert.match(js, /href = '#tool'/, 'skip link must still revert to #tool');
  assert.match(css, /\.skip-link:focus/, 'skip-link focus rule must still exist');
  assert.ok(html.includes('openAncestors'), 'disc glue script must still open collapsed ancestors on anchor jumps');
  assert.ok(html.includes('a[href^="#"'), 'glue script must still listen to in-page anchors');
  // Drawer keyboard path (inline script in app.html).
  assert.ok(html.includes('aria-controls="appNav"'), 'toggle must control appNav');
  assert.ok(html.includes('aria-expanded'), 'toggle must expose aria-expanded');
  assert.ok(html.includes("closeBtn.focus()") || html.includes('closeBtn) closeBtn.focus'), 'focus must move into the drawer on open');
  assert.ok((html.match(/toggle\.focus\(\)/g) || []).length >= 3, 'every close path must return focus to the toggle');
  assert.ok(html.includes("e.key === 'Escape'"), 'Escape must close the drawer');
  assert.ok(html.includes('nav-scrim'), 'scrim must still exist for drawer close');
});

test('four verdict links are inert-but-explained pre-run in markup', () => {
  const body = navBlocks[0][1];
  for (const h of VERDICT_LINKS) {
    const tag = body.match(new RegExp(`<a[^>]*href="${h}"[^>]*>`));
    assert.ok(tag, `nav must contain ${h}`);
    assert.ok(tag[0].includes('data-verdict-link'), `${h} must carry data-verdict-link`);
    assert.ok(tag[0].includes('aria-disabled="true"'), `${h} must be aria-disabled pre-run`);
    assert.ok(tag[0].includes('aria-describedby="verdictNavNote"'), `${h} must describe the explanation note`);
    assert.ok(tag[0].includes('title="Appears after a verdict runs"'), `${h} must carry the f-a11y explanatory title pre-run`);
    const labels = { '#verdict': 'Verdict', '#receiptSection': 'Receipts', '#verdictSheet': 'Sheet', '#raceSection': 'Race' };
    assert.ok(tag[0].includes(`aria-label="${labels[h]} — appears after a verdict runs"`), `${h} must carry the f-a11y explanatory aria-label pre-run`);
    assert.ok(tag[0].includes('>') && !tag[0].includes('inert'), `${h} must stay focusable (aria-disabled, never HTML inert)`);
  }
  assert.ok(body.includes('id="verdictNavNote"'), 'explanation note must be in the nav');
  assert.ok(body.includes('not shown yet'), 'note must say the sections are not shown yet pre-run');
  assert.ok(body.includes('id="verdictNavStatus"'), 'live-region status for inert clicks must be in the nav');
  assert.ok(body.includes('aria-live="polite"'), 'inert-click status must be a polite live region');
});

test('verdict-nav sync: live only for visible sections, never unhides anything', () => {
  assert.ok(js.includes('function syncVerdictNav'), 'app.js must define syncVerdictNav');
  assert.ok(js.includes('function wireSidebarNav'), 'app.js must define wireSidebarNav');
  const sync = js.slice(js.indexOf('function syncVerdictNav'), js.indexOf('function wireSidebarNav'));
  assert.ok(sync.includes('!target.hidden'), 'liveness must be read from the section hidden state');
  assert.ok(!sync.includes('.hidden = false'), 'sync must NEVER unhide a section to fake liveness');
  assert.ok(sync.includes("setAttribute('aria-disabled', 'true')"), 'pending links must gain aria-disabled');
  assert.ok(sync.includes("removeAttribute('aria-disabled')"), 'live links must lose aria-disabled');
  assert.ok(sync.includes("getAttribute('title') === 'Appears after a verdict runs'"), 'live links must lose title ONLY when it is the exact explanatory string');
  assert.ok(sync.includes("VERDICT_NAV_EXPLAIN"), 'live links must lose aria-label ONLY when it is the exact explanatory string');
  assert.ok(sync.includes("setAttribute('title', 'Appears after a verdict runs')"), 'pending links must regain the explanatory title');
  assert.ok(sync.includes("setAttribute('aria-label'"), 'pending links must regain the explanatory aria-label');
  // Glue backstop (app.html): intercept registered BEFORE openAncestors.
  assert.ok(html.includes('a[aria-disabled="true"]'), 'glue must intercept aria-disabled links');
  assert.ok(html.indexOf('a[aria-disabled="true"]') < html.indexOf('a[href^="#"'), 'glue intercept must precede the openAncestors listener');
  assert.ok(sync.includes('raceSection'), 'Race must be handled (live only when a race ran)');
  const wire = js.slice(js.indexOf('function wireSidebarNav'));
  assert.ok(wire.includes('preventDefault'), 'inert click must be intercepted, not jumped');
  assert.ok(wire.includes('stopImmediatePropagation'), 'inert click must not close the drawer');
  assert.ok(wire.includes('race'), 'Race must get its own race-specific explanation');
  // Retarget-site mirroring: both existing sites call the sync.
  assert.ok(js.includes('syncVerdictNav()'), 'sync must be wired at load and at the retarget sites');
  const renderTail = js.slice(js.indexOf("skip.textContent = 'Skip to verdict'"));
  assert.ok(renderTail.slice(0, 400).includes('syncVerdictNav()'), 'renderVerdict must sync after the skip retarget');
  // hideVerdict sync must run AFTER every hidden flag is set (f-a11y
  // ordering), not next to the skip revert at the top of the function.
  const hideBody = js.slice(js.indexOf('function hideVerdict'), js.indexOf('function setRunning'));
  assert.ok(hideBody.includes('syncVerdictNav()'), 'hideVerdict must sync');
  assert.ok(hideBody.indexOf('syncVerdictNav()') > hideBody.indexOf("if (sheet) sheet.hidden = true"),
    'hideVerdict sync must run after the hidden flags are set, so the derived state is final');
  assert.ok(!wire.includes('.hidden = false'), 'click wiring must never unhide a section');
});

test('sidebar CSS: persistent desktop, drawer at narrow widths, reduced-motion safe', () => {
  assert.match(css, /\.sidebar-panel\s*\{[^}]*position:\s*fixed[^}]*left:\s*0/, 'panel must be fixed left on desktop');
  assert.match(css, /\.sidebar-panel\s*\{[^}]*width:\s*280px/, 'panel must be 280px on desktop');
  assert.match(css, /\.app-shell\s*\{[^}]*margin-left:\s*280px/, 'content must offset by the panel width');
  assert.match(css, /\.sidebar-panel\.is-open\s*\{[^}]*transform:\s*translateX\(0\)/, 'drawer must slide in when open');
  assert.ok(css.includes('translateX(-105%)'), 'drawer must sit off-canvas left when closed');
  assert.ok(css.includes('env(safe-area-inset-top)'), 'panel must carry the safe-area top inset');
  assert.ok(css.includes('body.app-page { padding-bottom: 0; }') || /body\.app-page\s*\{[^}]*padding-bottom:\s*0/.test(css), 'toolbar body padding must go with the toolbar');
  assert.match(css, /\.nav-links a\s*\{[^}]*min-height:\s*48px/, 'sidebar links must keep 48px targets');
  assert.match(css, /\.sidebar-panel \.nav-verdict-link\[aria-disabled="true"\]/, 'inert links must have a muted style');
  assert.match(css, /\.sidebar-panel \.nav-verdict-link\[aria-disabled="true"\]\s*\{[^}]*opacity:\s*0\.55/, 'inert links must be dimmed to exactly 0.55 like the f-a11y fix');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced.includes('.sidebar-panel'), 'reduced-motion block must cover the sidebar panel');
  assert.ok(reduced.includes('.nav-links a::after'), 'reduced-motion block must still cover the nav underline slide');
  assert.ok(css.includes('.sidebar-panel, .sidebar-toggle, .nav-scrim'), 'print must hide sidebar chrome');
  assert.ok(css.includes('btn--primary'), 'glowing primary actions must survive in the panel');
});

test('live-inspection destination inventory: every drawer destination accounted for, nothing else', () => {
  // Live drawer destinations, in drawer order: Tool, Verdict, Evidence,
  // Formula, Proof, Workspace, Ledger, Receipts, Sheet, Race, Trials,
  // Limits, Oracle, Landing — plus the orange "Check an offer" primary
  // action. "PROOF INDEX" is a label, not a destination; "Close" is
  // the sidebar collapse control, not a destination.
  const body = navBlocks[0][1];
  const linkTexts = [...body.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1].trim());
  assert.deepEqual(linkTexts,
    ['Tool', 'Verdict', 'Evidence', 'Formula', 'Proof', 'Workspace', 'Ledger',
     'Receipts', 'Sheet', 'Race', 'Trials', 'Limits', 'Oracle', 'Landing'],
    `sidebar link labels must be exactly the live drawer destinations in order: ${linkTexts}`);
  const hrefs = [...body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs[4], '#depth', 'the drawer "Proof" destination must resolve to #depth');
  assert.ok(body.includes('>Proof index<'), 'PROOF INDEX must survive as a label, not a link');
  assert.ok(!linkTexts.includes('Proof index'), 'PROOF INDEX must not be counted as a destination');
  assert.ok(!linkTexts.includes('Close'), 'Close must not be counted as a destination');
  const panel = html.slice(html.indexOf('<div class="sidebar-panel"'), html.indexOf('<div class="app-shell"'));
  assert.ok(panel.includes('>Check an offer<'), 'the orange "Check an offer" primary action must survive in the panel');
  assert.ok(panel.includes('class="btn nav-close"'), 'Close must survive as the sidebar collapse control (button, not link)');
  assert.ok(panel.includes('aria-label="Close navigation"'), 'collapse control must keep its accessible name');
});

test('all four drawer close paths return focus to the toggle (scrim fix)', () => {
  // Drawer contract: focus in on open, focus return on EVERY close.
  // The sidebar batch shipped the scrim path as a bare closeDrawer
  // reference (no focus return); this test pins the fix for all four
  // close paths, each of which must call closeDrawer() then
  // toggle.focus() in the same handler.
  assert.ok(html.includes("if (panel.classList.contains('is-open')) { closeDrawer(); toggle.focus(); }"),
    'toggle-click close must return focus to the toggle');
  assert.ok(html.includes("closeBtn.addEventListener('click', function () { closeDrawer(); toggle.focus(); })"),
    'Close-button close must return focus to the toggle');
  assert.ok(html.includes("scrim.addEventListener('click', function () { closeDrawer(); toggle.focus(); })"),
    'scrim close must return focus to the toggle');
  assert.ok(!html.includes("scrim.addEventListener('click', closeDrawer)"),
    'scrim must not pass closeDrawer bare (that drops focus on the off-canvas Close button)');
  assert.ok(html.includes("if (e.key === 'Escape' && panel.classList.contains('is-open')) { closeDrawer(); toggle.focus(); }"),
    'Escape close must return focus to the toggle');
  assert.equal((html.match(/toggle\.focus\(\)/g) || []).length, 4,
    'exactly four toggle.focus() calls: one per close path (toggle-click, Close, scrim, Escape)');
});
