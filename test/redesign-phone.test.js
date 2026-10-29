// Redesign round — landing phone section (Worker 2).
// The landing phone shows a recorded-demo animation, never a live app:
// zero embeds, a persistent recorded label, recorded numbers only, and
// the real-app routes (APK release URL + live-demo link) kept distinct.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const landing = readFileSync(fileURLToPath(new URL('../frontend/index.html', import.meta.url)), 'utf8');
const mobileCss = readFileSync(fileURLToPath(new URL('../frontend/mobile-section.css', import.meta.url)), 'utf8');
const simCss = readFileSync(fileURLToPath(new URL('../frontend/sim-animation.css', import.meta.url)), 'utf8');
const simJs = readFileSync(fileURLToPath(new URL('../frontend/sim-animation.js', import.meta.url)), 'utf8');
const landingMobileCss = readFileSync(fileURLToPath(new URL('../frontend/landing-mobile.css', import.meta.url)), 'utf8');

const APK_URL = 'https://github.com/mohamedwael201193/OfferSheet/releases/download/android-app-v1.0.0/offersheet-release.apk';
const LABEL = 'Recorded demo — 29 Oct 2026 trial, not a live verdict';

test('phone section embeds nothing: zero iframe in the landing', () => {
  assert.equal((landing.match(/<iframe/g) || []).length, 0, 'index.html must contain zero <iframe');
  assert.ok(!landing.includes('msAppFrame'), 'the old live-frame id must be gone');
  assert.ok(!landing.includes('src="app.html"'), 'no app.html embed source may remain');
});

test('simulation label is present verbatim, on/above the frame', () => {
  const phone = landing.slice(landing.indexOf('id="get-the-app"'));
  assert.ok(phone.includes(LABEL), 'phone section must carry the recorded label verbatim');
  const labelAt = phone.indexOf(LABEL);
  const deviceAt = phone.indexOf('class="ms-device"');
  assert.ok(labelAt !== -1 && deviceAt !== -1 && labelAt < deviceAt,
    'the label must sit on or directly above the frame');
  assert.ok(phone.includes('class="sim-label"'), 'the label element must exist');
  assert.ok(phone.includes('class="sim-stage"'), 'the animation container must exist');
});

test('animation shows only the recorded trial, never a live-verdict claim', () => {
  const phone = landing.slice(landing.indexOf('id="get-the-app"'));
  assert.ok(phone.includes('2,084'), 'animation must show the recorded break-even 2,084');
  assert.ok(phone.includes('Billie Eilish') && phone.includes('New York')
    && phone.includes('$250,000') && phone.includes('$120'),
    'animation must carry the recorded trial inputs');
  // "For a live verdict, use the app" is a route to the real app, not a
  // claim about the animation — the forbidden claims are that the phone
  // itself is live or is the app.
  assert.ok(!phone.toLowerCase().includes('running live'), 'phone must not claim to run live');
  assert.ok(phone.includes('not a live verdict'), 'phone must state the animation is not live');
  assert.ok(!phone.includes('Tap inside it'), 'no tap-inside-live-app copy may remain');
  assert.ok(!simJs.includes('fetch('), 'animation script must not fetch anything');
  assert.ok(!simJs.includes('/api'), 'animation script must not name a data endpoint');
  assert.ok(!simJs.includes('Math.ceil'), 'animation script must not compute a verdict (ceil step is static text)');
});

test('real-app routes stay separate and distinct from the animation', () => {
  assert.ok(landing.includes(`data-apk-url="${APK_URL}"`), 'APK button must keep the exact release URL');
  assert.ok(landing.includes('Download the Android app (APK)'), 'APK button text must stay');
  assert.ok(landing.includes('Try the live demo'), 'a live-demo link distinct from the animation must exist');
  assert.ok((landing.match(/href="app\.html"/g) || []).length >= 1, 'live-demo link must point at app.html');
});

test('professional device frame: bezel, island, side buttons, phone aspect', () => {
  assert.ok(mobileCss.includes('border-radius: 48px'), 'device shell must have a hardware corner radius');
  assert.ok(mobileCss.includes('aspect-ratio: 9 / 19.5'), 'screen must keep phone aspect ~9/19.5');
  assert.ok(mobileCss.includes('.ms-key--power') && mobileCss.includes('.ms-key--volume-up'),
    'side buttons must be present');
  assert.ok(landing.includes('class="sim-island"') || simCss.includes('.sim-island'),
    'a dynamic-island element must be present');
  assert.ok(mobileCss.includes('box-shadow') && mobileCss.includes('0 24px 48px'),
    'device must carry a realistic layered shadow');
});

test('reduced motion resolves the animation to its static final state', () => {
  assert.ok(simCss.includes('@media (prefers-reduced-motion: reduce)'),
    'sim-animation.css must handle prefers-reduced-motion');
  assert.ok(simJs.includes('prefers-reduced-motion'), 'sim-animation.js must check reduced motion');
  assert.ok(simCss.includes('.sim-js .sim-step { opacity: 1; }')
    || simCss.includes('opacity: 1'), 'reduced motion must show all steps');
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
  assert.ok(!landing.includes('/api'), 'landing must not name a data endpoint');
  assert.ok(!landing.includes('<script src="app.js"'), 'landing must not load app.js');
  assert.ok(!landing.includes('id="offerForm"'), 'landing must not carry the app form');
  assert.ok(landing.includes('<script src="landing.js"'), 'landing must still load landing.js');
  assert.ok(landing.includes('<script src="sim-animation.js"'), 'landing must load the animation script');
  assert.ok(landing.includes('sim-animation.css'), 'landing must load the animation stylesheet');
});
