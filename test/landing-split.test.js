// Landing/app split regressions (user order, 29 Oct 2026).
// The landing is display-only: no verdict machinery, no data calls.
// The app is the working page: every id app.js queries must be there
// (except runtime-created buttons and landing-only guarded hero ids).
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
  assert.ok(!landing.includes('/api'), 'landing must never name a data endpoint');
});

test('landing keeps the display sections and links into the app', () => {
  // MERGE (dark redesign): heroStage/dealStack removed with the 3D tilt stack
  // (user order: no stacked/tilted hero), and No. 01-05 numbering replaced by
  // micro-labels in the dark language. All other pins below stay enforced.
  for (const id of ['problem', 'how', 'arms', 'refuses', 'formula']) {
    assert.ok(landing.includes(`id="${id}"`), `landing must keep id="${id}"`);
  }
  // D-IMAGES: old illustration filenames replaced 1:1 by photographs;
  // the pin keeps its intent (arms + refusal sections still carry an image).
  for (const s of ['photo-arms-stage.webp', 'photo-refusal-room.webp']) {
    assert.ok(landing.includes(s), `landing must contain ${s}`);
  }
  assert.ok(landing.includes('Recorded example — 29 Oct 2026 trial, not a live verdict'),
    'arms showcase must label the recorded trial as recorded, never live');
  assert.ok(landing.includes('Gut (LLM alone)') && landing.includes('Graph (Qloo-grounded')
    && landing.includes('Web (LLM + Wikidata facts)'), 'arms showcase must name all three arms');
  assert.ok(landing.includes('Clairo') && landing.includes('Olivia Rodrigo')
    && landing.includes('Armani White'), 'arms showcase must carry the recorded trial-1 picks');
  assert.ok(landing.includes('2,084 tickets'), 'arms showcase must carry the recorded break-even');
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
  // Runtime-created by design (buttons injected by app.js itself).
  // legProgress is created by appendLegProgress on first streamed leg event
  // and read only through that same function, so it never exists statically.
  // headlinerImage is created by renderHeadlinerImage on a verdict that
  // carries a Qloo image, and removed on the next render — same pattern.
  const runtime = new Set(['tryAgainBtn', 'priceFocusBtn', 'needsTryAgainBtn', 'legProgress', 'headlinerImage']);
  // Landing-only, guarded in app.js: heroFallback is touched only when an
  // img with id heroImg errors (no such img on the app page); dealStack /
  // heroStage are null-guarded before any tilt listener attaches.
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
