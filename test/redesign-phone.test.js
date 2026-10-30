// Redesign round — landing phone section (Worker 2), as redirected
// 03:29 EET 30 Oct: the staged film is out of the shipped product.
// The landing phone shows a STATIC record of the real 29 Oct 2026
// trial verdict, never a live app: zero embeds, a persistent recorded
// label inside the phone screen, recorded numbers only, and the
// real-app routes (APK release URL + live-demo link) kept distinct.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const landing = readFileSync(fileURLToPath(new URL('../frontend/index.html', import.meta.url)), 'utf8');
const mobileCss = readFileSync(fileURLToPath(new URL('../frontend/mobile-section.css', import.meta.url)), 'utf8');
const landingMobileCss = readFileSync(fileURLToPath(new URL('../frontend/landing-mobile.css', import.meta.url)), 'utf8');

const APK_URL = 'https://github.com/mohamedwael201193/OfferSheet/releases/download/android-app-v1.0.0/offersheet-release.apk';
const LABEL = 'Recorded demo — 29 Oct 2026 trial, not a live verdict';

test('phone section embeds nothing: zero iframe in the landing', () => {
  assert.equal((landing.match(/<iframe/g) || []).length, 0, 'index.html must contain zero <iframe');
  assert.ok(!landing.includes('msAppFrame'), 'the old live-frame id must be gone');
  assert.ok(!landing.includes('src="app.html"'), 'no app.html embed source may remain');
});

test('recorded label is present verbatim, inside the phone screen', () => {
  const phone = landing.slice(landing.indexOf('id="get-the-app"'));
  assert.ok(phone.includes(LABEL), 'phone section must carry the recorded label verbatim');
  const screenAt = phone.indexOf('class="ms-screen"');
  const labelAt = phone.indexOf(LABEL, screenAt);
  const homebarAt = phone.indexOf('ms-homebar', screenAt);
  assert.ok(screenAt !== -1 && labelAt !== -1 && homebarAt !== -1 && screenAt < labelAt && labelAt < homebarAt,
    'the label must sit inside the phone screen');
  assert.ok(phone.includes('class="record-label"'), 'the label element must exist');
  assert.ok(phone.includes('class="record-stage"'), 'the static record container must exist');
});

test('phone shows only the static recorded trial, never a live-verdict claim', () => {
  const phone = landing.slice(landing.indexOf('id="get-the-app"'));
  assert.ok(phone.includes('2,084'), 'phone must show the recorded break-even 2,084');
  assert.ok(phone.includes('Billie Eilish') && phone.includes('New York')
    && phone.includes('$250,000') && phone.includes('$120'),
    'phone must carry the recorded trial inputs');
  assert.ok(phone.includes('$250,000 ÷ $120'), 'phone must show the recorded formula division');
  // "For a live verdict, use the app" is a route to the real app, not a
  // claim about the phone — the forbidden claims are that the phone
  // itself is live or is the app.
  assert.ok(!phone.toLowerCase().includes('running live'), 'phone must not claim to run live');
  assert.ok(phone.includes('not a live verdict'), 'phone must state the record is not live');
  assert.ok(!phone.includes('Tap inside it'), 'no tap-inside-live-app copy may remain');
});

test('phone carries no staged-film markup', () => {
  const phone = landing.slice(landing.indexOf('id="get-the-app"'));
  assert.ok(!phone.includes('Frame 1 of 3') && !phone.includes('Frame 3 of 3'),
    'phone must carry no staged frames');
  assert.ok(!phone.includes('class="frames"'), 'phone must carry no filmstrip container');
  assert.ok(!phone.includes('sim-animation'), 'phone must not reference the removed staged-film files');
  assert.ok(!/sim-/.test(phone), 'phone must carry no staged-film class markup');
  assert.ok(!landing.includes('sim-animation.css') && !landing.includes('sim-animation.js'),
    'landing must not load the removed staged-film files');
});

test('real-app routes stay separate and distinct from the record', () => {
  assert.ok(landing.includes(`href="${APK_URL}"`), 'APK anchor must keep the exact release URL');
  assert.ok(landing.includes('Download the Android app (APK)'), 'APK anchor text must stay');
  assert.ok(landing.includes('Try the live demo'), 'a live-demo link distinct from the record must exist');
  assert.ok((landing.match(/href="app\.html"/g) || []).length >= 1, 'live-demo link must point at app.html');
});

test('professional device frame: bezel, island, side buttons, phone aspect', () => {
  assert.ok(mobileCss.includes('border-radius: 48px'), 'device shell must have a hardware corner radius');
  assert.ok(mobileCss.includes('aspect-ratio: 9 / 19.5'), 'screen must keep phone aspect ~9/19.5');
  assert.ok(mobileCss.includes('.ms-key--power') && mobileCss.includes('.ms-key--volume-up'),
    'side buttons must be present');
  assert.ok(landing.includes('class="record-island"') || mobileCss.includes('.record-island'),
    'a dynamic-island element must be present');
  assert.ok(mobileCss.includes('box-shadow') && mobileCss.includes('0 24px 48px'),
    'device must carry a realistic layered shadow');
});

test('static record styling lives in mobile-section.css', () => {
  assert.ok(mobileCss.includes('.record-label'), 'mobile-section.css must style the recorded label');
  assert.ok(mobileCss.includes('.record-verdict-num'), 'mobile-section.css must style the record verdict number');
  assert.ok(mobileCss.includes('.record-row'), 'mobile-section.css must style the record rows');
});

test('footer keeps its honest content and cannot overflow at 390px', () => {
  // Method (stated honestly): structural, not a pixel render — the
  // footer grid is single-column below 720px, every footer line wraps
  // on any character, and the only long token (the repo URL) is inside
  // an overflow-wrap: anywhere rule. The coordinator's live render
  // (desktop + 390px) is the pixel check for this item.
  for (const s of [
    'What results do NOT establish',
    'OfferSheet — one money decision, before you sign.',
    'Open source — MIT License.',
    'Colophon — Set in a rounded display face and one grotesk sans.', // MERGE (dark redesign): faces changed by order; wording updated, pin kept
    'github.com/mohamedwael201193/OfferSheet',
  ]) assert.ok(landing.includes(s), `footer must keep verbatim: ${s}`);
  assert.ok(landingMobileCss.includes('.footer-meta'), 'footer meta layout must be defined');
  assert.ok(landingMobileCss.includes('overflow-wrap: anywhere'), 'footer lines must wrap anywhere');
  assert.ok(!landingMobileCss.includes('min-width: 390px') && !landingMobileCss.includes('width: 390px'),
    'footer must not hard-code a viewport width');
});

test('landing invariants still hold after the redesign', () => {
  // NOSIM NARROWING (30 Oct 2026): the bare-string check used to read
  // the whole landing, but it now contradicts v3-spec, which REQUIRES
  // the honest PWA-note prose "/api/* calls are network-only" in the
  // phone section — prose describing the service worker's real
  // behaviour, not a call. So the PWA-note block is stripped first and
  // the no-endpoint guarantee is kept in full on the remainder, plus
  // a behavioural pin (no fetch/XHR at all in landing markup) so the
  // guarantee is about calls, not about one string.
  const landingWithoutPwaNote = landing.replace(/<p class="pwa-note">[\s\S]*?<\/p>/, '');
  assert.ok(!landingWithoutPwaNote.includes('/api'), 'landing outside the PWA note must not name a data endpoint');
  assert.ok(!landingWithoutPwaNote.includes('fetch(') && !landingWithoutPwaNote.includes('XMLHttpRequest'),
    'landing markup must make no data calls');
  assert.ok(!landing.includes('<script src="app.js"'), 'landing must not load app.js');
  assert.ok(!landing.includes('id="offerForm"'), 'landing must not carry the app form');
  assert.ok(landing.includes('<script src="landing.js"'), 'landing must still load landing.js');
  assert.ok(!landing.includes('<script src="sim-animation.js"'), 'landing must not load the removed staged-film script');
  assert.ok(!landing.includes('sim-animation.css'), 'landing must not load the removed staged-film stylesheet');
});
