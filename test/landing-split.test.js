// Landing/app split regressions, adapted for the v3 redesign (30 Oct 2026).
// The landing is display-only: no verdict machinery, no data calls.
// The app is the working page: every id app.js queries must be there
// (except runtime-created buttons and landing-only guarded hero ids).
// v3 change: the landing sections are hero/statement/flow/evidence/
// formula/recorded/dashboard/ledger/get-the-app (the old problem/how/
// arms/refuses sections and their showcase images are retired with the
// old landing), and the app sidebar carries exactly five destinations.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const landing = readFileSync(fileURLToPath(new URL('../frontend/index.html', import.meta.url)), 'utf8');
const app = readFileSync(fileURLToPath(new URL('../frontend/app.html', import.meta.url)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('../frontend/app.js', import.meta.url)), 'utf8');
const landingJs = readFileSync(fileURLToPath(new URL('../frontend/landing.js', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../frontend/styles.css', import.meta.url)), 'utf8');

const idsOf = (html) => new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const anchorsOf = (html) => [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);

test('landing is display-only: no verdict machinery, no data calls', () => {
  for (const id of ['offerForm', 'verdict', 'receiptSection', 'raceSection', 'raceToggleWrap',
    'partialSection', 'depthToolsBody', 'benchBlock', 'workedExample', 'qlooBadge',
    'artist', 'guarantee', 'ticketPrice', 'capacity', 'status']) {
    assert.ok(!landing.includes(`id="${id}"`), `landing must not contain id="${id}"`);
  }
  assert.ok(!landing.includes('<script src="app.js"'), 'landing must not load app.js');
  assert.ok(landing.includes('<script src="landing.js"'), 'landing must load landing.js');
  assert.ok(!landingJs.includes('fetch('), 'landing.js must never fetch');
  assert.ok(!landingJs.includes('/api'), 'landing.js must never name a data endpoint');
  // NOSIM NARROWING (30 Oct 2026): the bare-string check below used to
  // read the whole landing, but it now contradicts v3-spec, which
  // REQUIRES the honest PWA-note prose "/api/* calls are network-only"
  // in the phone section — prose describing the service worker's real
  // behaviour, not a call. So the PWA-note block is stripped first and
  // the no-endpoint guarantee is kept in full on the remainder, plus
  // a behavioural pin (no fetch/XHR at all in landing markup) so the
  // guarantee is about calls, not about one string.
  const landingWithoutPwaNote = landing.replace(/<p class="pwa-note">[\s\S]*?<\/p>/, '');
  assert.ok(!landingWithoutPwaNote.includes('/api'), 'landing outside the PWA note must never name a data endpoint');
  assert.ok(!landingWithoutPwaNote.includes('fetch(') && !landingWithoutPwaNote.includes('XMLHttpRequest'),
    'landing markup must make no data calls');
});

test('landing keeps the v3 display sections and links into the app', () => {
  for (const id of ['hero', 'statement', 'flow', 'evidence', 'formula', 'recorded', 'dashboard', 'ledger', 'get-the-app']) {
    assert.ok(landing.includes(`id="${id}"`), `landing must keep id="${id}"`);
  }
  assert.ok(landing.includes('A promoter should never sign a guarantee'), 'statement section must carry the v3 sentence');
  assert.ok(landing.includes('Recorded · Trial 1') && landing.includes('Recorded · Trial 2') && landing.includes('Recorded · Trial 3'),
    'recorded band must carry all three trials');
  assert.ok(landing.includes('No show has settled yet'), 'ledger must carry the empty-settle note');
  assert.ok(landing.includes('2,084 tickets'), 'landing must carry the recorded break-even');
  const appLinks = (landing.match(/href="app\.html"/g) || []).length;
  assert.ok(appLinks >= 3, `landing must link to app.html (found ${appLinks})`);
  assert.ok(!landing.includes('generic web'), 'landing must not contain a generic-web claim');
});

test('every in-page anchor resolves on its own page', () => {
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    const ids = idsOf(html);
    for (const a of anchorsOf(html)) {
      assert.ok(ids.has(a), `${name}: anchor #${a} must resolve on the same page`);
    }
  }
});

test('app carries every id app.js queries (minus runtime + landing-only guards)', () => {
  const queried = new Set([
    ...appJs.matchAll(/\$\('([^']+)'\)/g),
    ...appJs.matchAll(/getElementById\('([^']+)'\)/g),
    ...appJs.matchAll(/getElementById\("([^"]+)"\)/g),
  ].map((m) => m[1]));
  const runtime = new Set(['tryAgainBtn', 'priceFocusBtn', 'needsTryAgainBtn', 'legProgress', 'headlinerImage']);
  const landingOnly = new Set(['heroFallback', 'dealStack', 'heroStage']);
  const ids = idsOf(app);
  const missing = [...queried].filter((id) => !ids.has(id) && !runtime.has(id) && !landingOnly.has(id));
  assert.deepEqual(missing, [], `app.html is missing queried ids: ${missing.join(', ')}`);
  for (const id of [...landingOnly]) {
    assert.ok(!app.includes(`id="${id}"`), `app must not carry landing-only id="${id}"`);
  }
  assert.ok(app.includes('<script src="app.js"'), 'app must load app.js');
  assert.ok(!app.includes('<script src="landing.js"'), 'app must not load landing.js');
  assert.ok(app.includes('href="index.html"'), 'app must link back to the landing');
  assert.ok(!app.includes('generic web'), 'app must not contain a generic-web claim');
});

test('split CSS: braces balanced, app chrome + landing sections present', () => {
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  assert.equal(open, close, `CSS braces must balance (${open} vs ${close})`);
  for (const cls of ['.appbar', '.app-kicker', '.nav-cta', '.arms-grid', '.arm-card',
    '.refuse-grid', '.refuse-card', '.cta-band', '.recorded-label']) {
    assert.ok(css.includes(cls), `styles.css must define ${cls}`);
  }
});
