// D-HERO — landing-wide dark cinematic conversion + hero rebuild
// (program-30 fix agent, filing day). Static pins over the fixed files
// in frontend/ (same layout as the f-adversarial-heading test: this
// file lives in test/, the fixed files in frontend/ next to it, so it
// runs unchanged when copied into a candidate-copy tree).
//
// Scope honoured by these pins:
//  - Hero block only in index.html (copy verbatim, image slot documented).
//  - Landing-wide dark expressed in styles.css only; mobile-section.css
//    and sim-animation.css are NOT edited (their pinned structure —
//    device shell, island, keys, aspect, reduced-motion — survives).
//  - Statement section CONTENT untouched (void-fill agent owns it);
//    only its styling is dark (it inherits #0A0A0A, no light rule).
//  - Exactly ONE <nav> element on the landing: the floating glass pill.
//    The top appbar is a <div> wordmark row, not a <nav> element — the
//    same distinction styles.css itself states and q2-single-nav uses.
//    This test pins that count + identity, so "single nav" is never
//    claimed here without the count behind it.
//  - No new numbers, claims, or links in the hero; no other section
//    restructured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const html = read('frontend/index.html');
const css = read('frontend/styles.css');
const js = read('frontend/landing.js');

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const heroBlock = () => {
  const m = html.match(/<section class="hero" id="hero"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(m, 'index.html must contain the hero section');
  return m[1];
};
const statementBlock = () => {
  const m = html.match(/<section class="statement" id="problem"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(m, 'index.html must contain the statement section');
  return m[1];
};
const navBlocks = () => [...stripComments(html).matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)];

test('D-HERO hero: giant display present, copy verbatim, no new claims', () => {
  const hero = heroBlock();
  assert.ok(hero.includes('<h1 class="display" data-reveal>How many tickets must sell before you sign?</h1>'),
    'hero H1 wording must be unchanged');
  assert.ok(hero.includes('Enter the artist, the city, and the guarantee. OfferSheet returns the break-even ticket count — with the audience evidence and the receipts behind it — before you sign anything.'),
    'hero sub-copy must be unchanged');
  assert.ok(hero.includes('<a class="btn btn--primary btn--glow" href="app.html">Try the live demo</a>'),
    'hero primary CTA must be unchanged');
  assert.ok(hero.includes('<a class="btn btn--ghost" href="#arms">See the recorded evidence</a>'),
    'hero secondary CTA must be unchanged');
  assert.ok(css.includes('.hero h1.display { font-size: clamp(56px, 9vw, 128px);'),
    'hero headline must be giant (128px cap, 56px floor)');
  assert.ok(css.includes('.hero { position: relative;') && css.includes('background: #0A0A0A;'),
    'hero background must be explicitly near-black #0A0A0A');
});

test('D-HERO hero image slot: exact slot the images agent swaps into', () => {
  const hero = heroBlock();
  const m = hero.match(/<img[^>]*>/);
  assert.ok(m, 'hero figure must contain an img');
  assert.ok(m[0].includes('id="hero-image"'), 'hero img must carry id="hero-image"');
  assert.ok(m[0].includes('class="hero-image"'), 'hero img must carry class="hero-image"');
  // D-IMAGES merge: the swap this test anticipated has landed — the slot pins
  // now assert the photographic slot (same strictness: exact src/alt/caption).
  assert.ok(m[0].includes('src="assets/photo-hero-room.webp"'), 'hero img src must be the photographic swap assets/photo-hero-room.webp');
  assert.ok(m[0].includes('alt="The room, empty, before the show"'), 'hero img alt must be the generic room alt');
  assert.ok(hero.includes('The room is the question, not the answer. The answer is a number, with receipts.'),
    'hero caption must stay generic (names no artist, claims no live data)');
  assert.ok(css.includes('.hero-figure img { border-radius: 0; width: 100%; height: clamp(440px, 56vh, 680px); object-fit: cover;'),
    'hero image must be a sharp-cornered full-bleed cover frame');
  assert.ok(css.includes('.hero-figure { position: relative; max-width: none; margin: 0; width: 100%; }'),
    'hero figure must break out of the 1200px column at plain 100% width (never 100vw)');
});

test('D-HERO single nav: exactly one <nav>, and it is the glass pill', () => {
  const blocks = navBlocks();
  assert.equal(blocks.length, 1, `landing must contain exactly one <nav> element, found ${blocks.length}`);
  const openTag = stripComments(html).match(/<nav\b[^>]*>/)[0];
  assert.ok(openTag.includes('class="nav-links"'), 'the single nav must be the glass pill (nav-links)');
  assert.ok(openTag.includes('aria-label="Sections"'), 'the single nav must keep its landmark label');
  const hrefs = [...blocks[0][1].matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(hrefs.length, 12, 'pill nav must keep its 12 links');
  assert.deepEqual(hrefs, ['#hero', '#collage', '#problem', '#how', '#arms', '#formula',
    '#trials', '#ledger', '#refuses', '#get-the-app', 'oracle.html', 'app.html'],
    'pill nav hrefs and order must be unchanged');
  assert.ok(html.includes('<div class="appbar">'), 'wordmark row must remain a <div> appbar, not a second <nav>');
  assert.ok(!stripComments(html).match(/<nav\b[^>]*class="appbar"/), 'appbar must never be a nav element');
  assert.ok(css.includes('.nav-links .glass-nav-cta { background: #FFFFFF; color: #0A0A0A; }'),
    'pill nav CTA must read as a white pill (refinement, targets unchanged)');
});

test('D-HERO landing-wide dark: phone screen + tokens flipped in styles.css only', () => {
  const darkBlock = css.match(/body\.landing-page \.ms-section \{([\s\S]*?)\n\}/);
  assert.ok(darkBlock, 'styles.css must carry the body.landing-page .ms-section dark block');
  const vars = darkBlock[1];
  for (const [name, value] of [
    ['--color-paper', '#0A0A0A'], ['--color-paper-hi', '#111111'],
    ['--color-ink', '#FFFFFF'], ['--color-ink-2', '#D4D4D4'],
    ['--color-muted', '#AAAAAA'], ['--color-accent', '#FFFFFF'],
    ['--color-focus', '#FFFFFF'],
  ]) assert.ok(vars.includes(`${name}: ${value};`), `dark block must set ${name} to ${value}`);
  assert.ok(vars.includes('--font-display: "Baloo 2"'), 'dark block must set the rounded display face');
  assert.ok(vars.includes('--font-body: "Inter"'), 'dark block must set Inter body');
  assert.ok(vars.includes('--radius-pill: 999px'), 'dark block must make section buttons pills, not rectangles');
  assert.ok(css.includes('body.landing-page .sim-verdict-num { font-family: "Baloo 2"'),
    'recorded-demo verdict number must leave serif for the rounded display face');
  assert.ok(css.includes('body.landing-page .footer-meta a:focus-visible { outline-color: #FFFFFF; }'),
    'footer focus outline must leave cadmium orange for white');
  assert.ok(css.includes('body.landing-page .story-section { background: #0A0A0A;'),
    'dead story-section rule must be hardened dark');
});

test('D-HERO statement: content untouched, styling dark', () => {
  const stmt = statementBlock();
  assert.ok(stmt.includes('<h2 class="display display--giant" data-clip>One money decision, before you sign.</h2>'),
    'statement headline must be unchanged');
  assert.ok(stmt.includes('Illustrative arithmetic on the recorded trial. Being wrong by 100 tickets = $12,000 of guarantee exposure (100 × 120 = 12,000). That 100-ticket gap is hypothetical — not a measured outcome, not a real loss, and not a prediction.'),
    'statement arithmetic paragraph must be unchanged');
  assert.ok(stmt.includes('A promoter signs a guarantee with a number in mind. OfferSheet makes that number explicit — tickets to break even — and shows exactly which audience evidence produced it, so the signature is a decision, not a guess.'),
    'statement promoter paragraph must be unchanged');
  const stmtRule = css.match(/\.statement \{[^}]*\}/);
  assert.ok(!stmtRule || !/(#f1f7f8|oklch\(97|#e97219)/.test(stmtRule[0]),
    'statement must carry no light-paper/orange styling');
});

test('D-HERO motion: hero settle once + figure reveal, all killed by reduced-motion', () => {
  assert.ok(css.includes('@keyframes hero-settle'), 'hero settle keyframes must exist');
  assert.ok(css.includes('.hero h1.display, .hero-sub { animation: hero-settle 600ms ease-out both; }'),
    'hero settle must be short (600ms) and on heading + sub only');
  assert.ok(css.includes('.hero-figure.js-hero { opacity: 0;'), 'figure reveal must be JS-gated (no-JS renders it visible)');
  assert.ok(css.includes('.hero-figure.js-hero.revealed { opacity: 1; transform: none; }'),
    'figure reveal must resolve to full opacity');
  assert.ok(js.includes("heroFigure.classList.add('js-hero')"), 'landing.js must gate the figure reveal');
  const reducedAt = js.indexOf("matchMedia('(prefers-reduced-motion: reduce)')");
  const heroAt = js.indexOf("heroFigure");
  assert.ok(reducedAt !== -1 && heroAt !== -1 && reducedAt < heroAt,
    'landing.js must check reduced-motion before any hero motion code');
  assert.ok(js.indexOf('if (reduced) return;') !== -1 && js.indexOf('if (reduced) return;') < heroAt,
    'landing.js must return early under reduced-motion, before the hero reveal');
  assert.ok(css.includes('.hero-figure.js-hero { opacity: 1; transform: none; }'),
    'reduced-motion CSS must force the figure visible');
});

test('D-HERO 390px usable: no horizontal scroll shape, 48px targets', () => {
  assert.ok(css.includes('overflow-x: clip;'), 'page must clip horizontal overflow');
  assert.ok(css.includes('.hero { position: relative;') && !/\.hero-figure[^}]*100vw/.test(css),
    'hero figure must never use 100vw (scrollbar-driven overflow)');
  assert.ok(css.includes('.hero h1.display { font-size: clamp(52px, 13.5vw, 84px);'),
    'narrow headline floor must be 52px (never the old 44px shrink)');
  assert.ok(css.includes('.hero-figure img { height: clamp(300px, 72vw, 440px); }'),
    'narrow hero image band must keep a 300px floor');
  assert.ok(css.includes('.hero-ctas .btn { width: 100%; }'),
    'narrow hero CTAs must stack full-width at 48px targets');
  assert.ok(css.includes('.app-kicker { display: none; }'),
    'narrow appbar must drop the kicker so the appbar stays one row');
  assert.ok(css.includes('.btn { display: inline-flex;') && css.includes('min-height: 48px;'),
    'buttons must keep the 48px target floor');
});

test('D-HERO scope: styles.css braces balance, no other file surface added', () => {
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  assert.equal(open, close, `fixed styles.css braces must balance (${open} vs ${close})`);
  assert.ok(!html.includes('<iframe'), 'landing must still embed nothing');
});
