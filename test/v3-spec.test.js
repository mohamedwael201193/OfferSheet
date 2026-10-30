// v3 redesign spec gates (30 Oct 2026, user-approved comp v3).
// Pins: kinpaku tokens verbatim, name bans, honesty rules, v3 section
// order and wiring, the five-destination app sidebar, and the static
// mobile record (03:29 EET 30 Oct user redirect: the staged film is
// gone; the phone shows a static record of the real 29 Oct 2026 trial
// only, with its persistent recorded label, APK + PWA note).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const F = (name) => fileURLToPath(new URL(`../frontend/${name}`, import.meta.url));
const read = (name) => readFileSync(F(name), 'utf8');
const landing = read('index.html');
const app = read('app.html');
const kinpaku = read('kinpaku.css');
const dashboard = read('dashboard.css');
const appJs = read('app.js');
const mobileCss = read('mobile-section.css');

// Banned names are assembled, never written literally, so this test file
// itself cannot trip the ban it enforces.
const BANNED = ['join' + 'mita', 'lapa.' + 'ninja', 'kur' + 'ate'];
const FRONTEND_FILES = readdirSync(F('')).filter((f) => /\.(html|js|css|webmanifest)$/.test(f));

test('kinpaku tokens are verbatim in kinpaku.css', () => {
  for (const token of [
    'oklch(84% 0.19 80.46)', 'oklch(70% 0.12 188)', 'oklch(7% 0.006 95)',
    'oklch(4% 0.004 95)', 'oklch(11% 0.006 95)', 'oklch(91% 0 0)',
    'oklch(88% 0 0)', 'oklch(72% 0 0)', 'oklch(78% 0 0 / 0.16)',
  ]) assert.ok(kinpaku.includes(token), `kinpaku.css must carry ${token}`);
  assert.ok(kinpaku.includes('border-radius: 14px') || kinpaku.includes('14px'), 'cards radius 14px');
});

test('name bans: zero occurrences anywhere in the payload frontend', () => {
  for (const file of FRONTEND_FILES) {
    const body = read(file).toLowerCase();
    for (const banned of BANNED) {
      assert.ok(!body.includes(banned), `${file} must not contain banned name ${banned}`);
    }
  }
  for (const banned of BANNED) {
    assert.ok(!landing.toLowerCase().includes(banned), `landing must not contain ${banned}`);
    assert.ok(!app.toLowerCase().includes(banned), `app must not contain ${banned}`);
  }
});

test('honesty: no winner badge, no multiplier language, no invented settle', () => {
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    assert.ok(!/winner:/i.test(html) && !/best offer is/i.test(html) && !/recommended offer/i.test(html),
      `${name} must not award a winner or recommend an offer (the denial sentence "no winner badge" is required copy, not a claim)`);
    assert.ok(!/5x|5×|\d+\s*times better/i.test(html), `${name} must not carry a multiplier claim`);
  }
  assert.ok(landing.includes('No show has settled yet'), 'landing ledger must state the settle is empty');
  assert.ok(!landing.includes('settled: $') && !landing.includes('Settled at'), 'landing must not invent a settled figure');
});

test('unknown-capacity wording is verbatim in the app engine', () => {
  assert.ok(appJs.includes('Venue capacity unknown — Ticketmaster returned no capacity for this room. Break-even is shown as tickets needed, not as a sellout percentage. Verify room size before signing.'),
    'app.js must keep the unknown-capacity wording verbatim');
  assert.ok(landing.includes('Venue capacity unknown — Ticketmaster returned no capacity for this room.'),
    'landing formula section must carry the unknown-capacity wording');
  assert.ok(appJs.includes("Cannot break even in this room at this guarantee"),
    'fail-closed cannot-break-even sentence must survive');
});

test('proof strip: real truncated hashes, requestId shown as dash, never invented', () => {
  for (const [trunc, full] of [
    ['affa6e35', 'affa6e35703be8f54ddeec84c42966a06093e94f21082f4cd446ada31f7f93f7'],
    ['ca25e61f', 'ca25e61f063d761de30b8d2378b3fa94a15520e3f51f2d681fa78e98f5f3bc4b'],
    ['300b8295', '300b829594a73e7e81960ee7a913b4e258610d8a1a70fe903fad57bff1a53cfc'],
  ]) {
    assert.ok(landing.includes(trunc), `proof strip must show truncated ${trunc}`);
    assert.ok(landing.includes(full), `proof strip must carry the full hash ${trunc} for replay`);
  }
  assert.ok(landing.includes('<td>—</td>'), 'proof strip requestId column must show a dash');
});

test('landing v3 sections appear in comp order', () => {
  const order = ['id="hero"', 'id="statement"', 'id="flow"', 'id="evidence"', 'id="formula"', 'id="recorded"', 'id="dashboard"', 'id="ledger"', 'id="get-the-app"'];
  let prev = -1;
  for (const marker of order) {
    const at = landing.indexOf(marker);
    assert.ok(at > prev, `${marker} must appear after the previous section`);
    prev = at;
  }
  assert.ok(landing.includes('Know the number'), 'hero display line must survive');
  assert.ok(landing.includes('he can\'t check.'), 'statement sentence must survive');
});

test('app sidebar: exactly five destinations, zero header, drawer at 820px', () => {
  const nav = app.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)[1];
  const hrefs = [...nav.matchAll(/href="(#[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['#tool', '#verdict', '#evidence', '#workspace', '#ledger'],
    `app nav must be exactly the five v3 destinations, found ${hrefs.join(', ')}`);
  assert.equal((app.match(/<header/g) || []).length, 0, 'app must contain zero <header> elements');
  assert.ok(dashboard.includes('@media (max-width: 820px)'), 'dashboard drawer breakpoint must stay at 820px');
});

test('app form strip order: Artist, City, Guarantee first', () => {
  const form = app.slice(app.indexOf('<form id="offerForm"'), app.indexOf('</form>'));
  const order = ['for="artist"', 'for="city"', 'for="guarantee"'];
  let prev = -1;
  for (const marker of order) {
    const at = form.indexOf(marker);
    assert.ok(at > prev, `${marker} must come before the next form field`);
    prev = at;
  }
  assert.ok(form.includes('Run the verdict'), 'form strip must keep the gold Run action');
});

test('app verdict unit sits on its own line', () => {
  assert.ok(kinpaku.includes('.verdict-unit { display: block;'), 'kinpaku.css must put the verdict unit on its own line');
  assert.ok(app.includes('tickets to break even'), 'app verdict must keep the unit label');
});

test('app race section stays hidden until a race runs', () => {
  assert.match(appJs, /\$\('raceSection'\)\.hidden = !race/, 'renderVerdict must set raceSection.hidden = !race');
  assert.ok(app.includes('id="raceSection"'), 'race section must exist in app.html');
});

test('mobile section: static recorded verdict, persistent label inside phone, APK + PWA note, no staged film', () => {
  // 03:29 EET 30 Oct user redirect: the staged film is out of the
  // shipped product. The phone is static only — no staged frames, no
  // staged-film stylesheet or script, no staged-film wording anywhere
  // on the landing, and no moving-content markup in the phone section.
  const phone = landing.slice(landing.indexOf('id="get-the-app"'));
  assert.ok(!landing.includes('sim-animation.css') && !landing.includes('sim-animation.js'),
    'landing must not load the removed staged-film files');
  // Assembled from fragments (same pattern as the name-ban test) so this
  // test file itself cannot trip the wording check it enforces.
  assert.ok(!new RegExp('simu' + 'lat', 'i').test(landing), 'landing must carry no staged-film wording of that form');
  assert.ok(!/filmstrip/i.test(landing) && !/auto-?play/i.test(phone),
    'landing must carry no filmstrip or auto-play wording');
  assert.ok(!phone.includes('Frame 1 of 3') && !phone.includes('Frame 3 of 3') && !phone.includes('class="frames"'),
    'phone section must carry no staged frames or filmstrip markup');
  assert.ok(!phone.includes('id="simStage"') && !phone.includes('id="simPause"') && !/sim-/.test(phone),
    'phone section must carry no staged-film markup at all');
  assert.ok(kinpaku.includes('@media (prefers-reduced-motion: reduce)'), 'kinpaku.css must still kill motion under reduced motion');
  // Static record of the real 29 Oct 2026 trial verdict.
  assert.ok(phone.includes('2,084'), 'phone must show the recorded break-even 2,084');
  assert.ok(phone.includes('Billie Eilish') && phone.includes('New York')
    && phone.includes('$250,000') && phone.includes('$120'),
    'phone must carry the recorded trial inputs');
  assert.ok(phone.includes('$250,000 ÷ $120'), 'phone must show the recorded formula division');
  // Persistent label INSIDE the phone frame (not only above it).
  assert.ok(phone.includes('Recorded demo — 29 Oct 2026 trial, not a live verdict'), 'persistent recorded label must be present');
  const screenAt = phone.indexOf('class="ms-screen"');
  const labelAt = phone.indexOf('Recorded demo — 29 Oct 2026 trial, not a live verdict', screenAt);
  const homebarAt = phone.indexOf('ms-homebar', screenAt);
  assert.ok(screenAt !== -1 && labelAt !== -1 && homebarAt !== -1 && screenAt < labelAt && labelAt < homebarAt,
    'the recorded label must sit inside the phone screen');
  assert.ok(phone.includes('class="record-label"'), 'the label must live on its own labelled element');
  assert.ok(mobileCss.includes('.record-verdict-num'), 'mobile-section.css must style the static record verdict number');
  assert.ok(!phone.includes('<iframe'), 'phone must embed nothing');
  assert.ok(landing.includes('data-apk-url="https://github.com/mohamedwael201193/OfferSheet/releases/download/android-app-v1.0.0/offersheet-release.apk"'),
    'APK download target must be the verified release URL');
  assert.ok(landing.includes('PWA note:'), 'phone section must carry the PWA note line');
  assert.ok(phone.includes('installable'), 'PWA note must state the app is installable');
  assert.ok(phone.includes('/api/*') && phone.includes('network-only'), 'PWA note must state /api/* is network-only');
  assert.ok(phone.includes('offline page'), 'PWA note must state the honest offline page');
  assert.ok(phone.includes('Try the live demo') && phone.includes('href="app.html"'),
    'phone section must keep the live-demo route to the real app');
});

test('every payload page the landing links to exists in frontend/', () => {
  for (const href of [...landing.matchAll(/href="([^"]+\.html[^"]*)"/g)].map((m) => m[1])) {
    const file = href.split('#')[0];
    assert.ok(existsSync(F(file)), `landing href ${href} must resolve to an existing frontend file`);
  }
  for (const href of ['app.html', 'trial-protocol.html', 'docs.html', 'tools.html', 'oracle.html']) {
    assert.ok(existsSync(F(href)), `payload must contain ${href}`);
  }
  assert.ok(existsSync(fileURLToPath(new URL('../phase3-evidence/live-verdict-billie.json', import.meta.url))),
    'payload must contain phase3-evidence/live-verdict-billie.json');
  assert.ok(existsSync(fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url))),
    'payload must contain the CI workflow');
});

test('recorded labels stay on all recorded content', () => {
  assert.ok(landing.includes('RECORDED NOT LIVE') || landing.includes('Recorded · Trial'), 'recorded band must be labeled recorded');
  assert.ok(landing.includes('RECORDED') || landing.includes('Recorded demo'), 'recorded demo label must be present');
  assert.ok(landing.includes('recorded 29 Oct 2026'), 'proof strip must be labeled recorded');
});
