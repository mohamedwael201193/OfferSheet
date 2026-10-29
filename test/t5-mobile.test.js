// T5 mobile surface (tech): 48px targets, 390px scroll containment,
// touch scroll capture, safe areas, PWA honesty, APK button shape.
// COORDINATOR RE-PINS (2026-10-30): the dark redesign replaced the old
// landing/app chrome, so six assertions pin NEW selectors. Requirements
// are unchanged (48px, safe areas, no overflow, single column); where a
// selector vanished because its element was replaced by order, the pin
// follows the replacement element. Two genuine gaps found by this test
// were fixed in CSS instead (cite-chip 32->48px; landing footer links
// + safe-area), not papered over here.
// Static assertions only (no browser, no device): every rule below is
// checked against the shipped markup/CSS/JS text, and the method is
// stated wherever a rendered/on-device check is still owed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../frontend/${rel}`, import.meta.url)), 'utf8');
const landing = read('index.html');
const app = read('app.html');
const styles = read('styles.css');
const dashboard = read('dashboard.css');
const workspaceCss = read('workspace.css');
const mobileCss = read('mobile-section.css');
const offline = read('offline.html');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));

const hasRule = (css, selectorPattern, propPattern) => {
  // Finds ANY block whose selector list matches; later appended blocks
  // win at equal specificity, so a match on the appended block counts.
  const re = new RegExp(`${selectorPattern}\\s*[,{][^}]*${propPattern}`, 's');
  return re.test(css);
};

test('landing nav, text links, CTA and footer links are 48px targets', () => {
  assert.ok(hasRule(styles, '\\.nav-links a', 'min-height:\\s*48px'), 'styles .nav-links a must be 48px');
  assert.ok(hasRule(styles, '\\.nav-links a', 'display:\\s*inline-flex'), 'inline <a> links ignore min-height without a display type');
  // Old .link-btn / .cta-line elements were replaced by the dark redesign:
  // the landing CTA is a .btn (48px rule) and footer links are .footer-meta a.
  assert.ok(hasRule(styles, '\\.btn', 'min-height:\\s*48px'), 'landing .btn CTAs must be 48px');
  assert.ok(/class="[^"]*\bnav-cta\b[^"]*\bbtn\b|class="[^"]*\bbtn\b[^"]*\bnav-cta\b/.test(landing), 'landing nav CTA element must carry .btn for its 48px height');
  assert.ok(hasRule(styles, '\\.footer-meta a', 'min-height:\\s*48px'), 'landing footer links must be 48px');
  assert.ok(hasRule(styles, '\\.footer-meta a', 'display:\\s*inline-flex'), 'footer <a> links need inline-flex or min-height is ignored');
});

test('app link buttons are 48px AND displayed, so the height is real', () => {
  assert.ok(hasRule(dashboard, '\\.link-btn', 'min-height:\\s*48px'), 'dashboard .link-btn must keep 48px');
  assert.ok(hasRule(dashboard, '\\.link-btn', 'display:\\s*inline-flex'), 'dashboard <a> link buttons need inline-flex or min-height is ignored');
  assert.ok(hasRule(dashboard, '\\.nav-links a', 'min-height:\\s*48px'), 'app nav links must be 48px');
  assert.ok(hasRule(dashboard, '\\.footer-cols a', 'min-height:\\s*48px'), 'app footer column links must be 48px');
  assert.ok(/class="[^"]*\bnav-cta\b[^"]*\bbtn\b|class="[^"]*\bbtn\b[^"]*\bnav-cta\b/.test(app), 'dashboard nav CTA element must carry .btn for its 48px height');
});

test('app and workspace controls keep 48px (regression pins)', () => {
  for (const [css, sel] of [
    [dashboard, '\\.btn'], [dashboard, '\\.btn-sm'], [dashboard, 'details summary'],
    [dashboard, '\\.cite-chip'], [dashboard, '\\.source-tag-chip'],
    [dashboard, '\\.ws-btn'],
  ]) {
    assert.ok(hasRule(css, sel, 'min-height:\\s*48px'), `dashboard ${sel} must be 48px`);
  }
  // Workspace text/number inputs share one multi-selector block, so the
  // block — not a single selector — is checked for the 48px height.
  // .ws-form rules are unscoped in dashboard.css, and .ws-form markup is
  // rendered by workspace.js only inside the #workspace section (see the
  // workspace.js form templates); the unscoped rule is the coverage.
  assert.ok(hasRule(dashboard, '\\.ws-form input\\[type="text"\\]', 'min-height:\\s*48px'), 'workspace form inputs must be 48px');
  assert.ok(hasRule(dashboard, '\\.ws-form input\\[type="radio"\\]', 'min-width:\\s*48px'), 'workspace radios must be 48px');
  assert.ok(hasRule(dashboard, '#workspace \\.ws-file-label', 'display:\\s*inline-flex'), 'inline <label> ignores ws-btn min-height until displayed as flex');
  assert.ok(hasRule(workspaceCss, '#workspace \\.ws-file-label', 'display:\\s*inline-flex'), 'workspace.css mirror must match');
  assert.ok(hasRule(mobileCss, '\\.ms-section \\.apk-button\\.ms-apk', 'min-height:\\s*48px'), 'APK button must be 48px');
  assert.ok(hasRule(mobileCss, '\\.ms-fullapp', 'min-height:\\s*48px'), 'live-demo link must be 48px');
  assert.ok(hasRule(mobileCss, '\\.ms-details summary', 'min-height:\\s*48px'), 'phone-section details summary must be 48px');
});

test('pages opt into viewport-fit=cover so safe-area insets are real', () => {
  for (const [name, html] of [['index', landing], ['app', app], ['offline', offline]]) {
    assert.ok(html.includes('viewport-fit=cover'), `${name} viewport must include viewport-fit=cover`);
  }
  assert.ok(dashboard.includes('env(safe-area-inset-top)'), 'app sticky header must pad for the top inset');
  assert.ok(dashboard.includes('env(safe-area-inset-bottom)'), 'app footer must pad for the bottom inset');
  assert.ok(styles.includes('env(safe-area-inset-bottom)'), 'landing footer must pad for the bottom inset');
  assert.ok(mobileCss.includes('env(safe-area-inset-bottom)'), 'phone section must pad for the bottom inset');
  assert.ok(mobileCss.includes('env(safe-area-inset-left)') && mobileCss.includes('env(safe-area-inset-right)'), 'phone section must keep left/right insets');
  assert.ok(offline.includes('env(safe-area-inset-bottom)'), 'offline page must pad for the bottom inset');
});

test('workspace and depth tables scroll inside their wrap, never the page', () => {
  for (const [name, css] of [['dashboard', dashboard], ['workspace', workspaceCss]]) {
    assert.ok(hasRule(css, '#workspace \\.ws-table-wrap|\\.ws-table-wrap', 'overflow-x:\\s*auto'), `${name} table wrap must scroll horizontally inside`);
    assert.ok(hasRule(css, '#workspace \\.ws-table-wrap|\\.ws-table-wrap', 'overflow-y:\\s*hidden'), `${name} table wrap must not become a vertical scroll container`);
    assert.ok(hasRule(css, '#workspace \\.ws-table-wrap|\\.ws-table-wrap', 'overscroll-behavior-x:\\s*contain'), `${name} table wrap must contain horizontal overscroll`);
  }
  assert.ok(dashboard.includes('min-width: 640px') && dashboard.includes('.ws-table'), 'comparison table keeps its 640px floor inside the wrap');
  assert.ok(styles.includes('overflow-x: clip') && dashboard.includes('overflow-x: clip'), 'both pages must clip page-level horizontal overflow');
  assert.ok(hasRule(dashboard, '\\.rail > \\*', 'min-width:\\s*0'), 'rails must not be pushed by table min-content');
  assert.ok(hasRule(dashboard, '#workspace \\.ws-panel', 'min-width:\\s*0'), 'workspace panels must not be pushed by table min-content');
  assert.ok(hasRule(dashboard, '\\.sheet-head > div', 'min-width:\\s*0'), 'sheet heads must not be pushed by long titles');
});

test('narrow nav rows and formula stack instead of overflowing at 390px', () => {
  assert.ok(dashboard.includes('overscroll-behavior-x: contain'), 'nav/table scrollers must contain overscroll');
  const narrow = dashboard.slice(dashboard.indexOf('@media (max-width: 640px)', dashboard.indexOf('T5 mobile surface')));
  assert.ok(/\.diagram-cell\s*\{[^}]*flex:\s*1 1 100%/.test(narrow), 'diagram cells must stack full-width at narrow widths so nowrap labels cannot overflow');
  assert.ok(/\.nav-group\s*\{[^}]*overflow-y:\s*hidden/.test(narrow), 'narrow nav rows must not capture vertical scroll');
  // The old tall sticky header is gone by redesign (appbar is static,
  // see the dashboard.css header comment); floating elements sit at the
  // bottom, so jump targets need no top clearance margin. Pin the static
  // header instead of the obsolete 240px margin.
  const headerBlock = dashboard.match(/\.nav, \.appbar \{[^}]*\}/);
  assert.ok(headerBlock && !/position:\\s*sticky/.test(headerBlock[0]), 'dashboard header must stay static (no sticky header to clear)');
});

test('service worker keeps /api/* network-only and never caches a verdict', () => {
  assert.ok(/if \(req\.method !== 'GET' \|\| isApiRequest\(url\)/.test(sw), 'API and non-GET traffic must take the network-only branch');
  assert.ok(/function isApiRequest\(url\) \{\s*return url\.pathname\.indexOf\('\/api\/'\) === 0;/.test(sw), 'API detection must be the /api/ path prefix');
  assert.ok(sw.includes('cache.addAll([OFFLINE_PAGE])'), 'install must precache only the offline page');
  assert.ok(!/cache\.addAll\(\[[^\]]*api/i.test(sw), 'install must never precache an API entry');
  assert.ok(/if \(res && res\.ok\)/.test(sw), 'static revalidation must only store successful responses');
  assert.ok(sw.includes("offersheet-static-v2"), 'cache name must be v2 so the corrected offline page propagates');
  assert.ok(app.includes("navigator.serviceWorker.register('/sw.js')"), 'app must register the worker');
  assert.ok(landing.includes("navigator.serviceWorker.register('/sw.js')"), 'landing must register the worker');
});

test('offline page shows no number and no stale result, and no false storage claim', () => {
  assert.ok(offline.includes('No verdict, no number, no stale result'), 'offline page must state the no-number rule');
  assert.ok(!offline.includes('Nothing you entered was kept on this phone'), 'offline page must not claim nothing is kept: workspaces persist on-device by design');
  assert.ok(offline.includes('stays on this device only'), 'offline page must state the on-device storage truth');
  assert.ok(!/\b2,084\b/.test(offline), 'offline page must contain no verdict number');
  assert.ok(hasRule(offline, 'button', 'min-height:\\s*48px'), 'offline retry button must be explicitly 48px');
});

test('manifest is valid, matches the theme, and carries installable icons', () => {
  assert.equal(manifest.name, 'OfferSheet');
  assert.equal(manifest.short_name, 'OfferSheet');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  // Pin moved with the dark-theme alignment fix (was '#030e1a'): the
  // manifest theme now matches the pages' dark theme-color #0A0A0A.
  // Same requirement, new value — not a weakening.
  assert.equal(manifest.theme_color, '#0A0A0A');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'manifest must carry 192 and 512 icons');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'manifest must carry a maskable icon');
  assert.ok(landing.includes('href="/manifest.webmanifest"') && app.includes('href="/manifest.webmanifest"'), 'both pages must link the manifest');
});

test('APK control is a real button whose visible text shows no URL string', () => {
  const btn = landing.match(/<button class="apk-button ms-apk"[^>]*>([^<]*)<\/button>/);
  assert.ok(btn, 'landing must carry the APK <button>');
  assert.ok(!btn[1].includes('http'), 'APK button visible text must not display a URL');
  assert.ok(landing.includes('data-apk-url="https://github.com/mohamedwael201193/OfferSheet/releases/download/android-app-v1.0.0/offersheet-release.apk"'), 'button must keep its release download target unchanged');
  const note = landing.match(/<p class="apk-note">([^<]*)<\/p>/);
  assert.ok(note && !note[1].includes('http'), 'APK note must not display a URL string either');
  assert.ok(landing.includes('Android APK via GitHub Release'), 'APK note must describe the route without a URL');
});

test('app dashboard stays single-column below the desktop breakpoint', () => {
  // The dark redesign made the dashboard a single divided column at ALL
  // widths (stronger than the old rule, which allowed splits above
  // breakpoints). Pin never-splits, not splits-only-above.
  assert.ok(!/\.desk \{[^}]*grid-template-columns/.test(dashboard), 'dashboard .desk must never split into columns');
  assert.ok(!/\.lower-grid \{[^}]*grid-template-columns/.test(dashboard), 'dashboard .lower-grid must never split into columns');
  assert.ok(/\.desk \{[^}]*display:\s*block/.test(dashboard), 'dashboard .desk must be a single block column');
});
