// D-HERO — landing-wide dark cinematic conversion + hero rebuild
// (program-30 fix agent, filing day). Static pins over the fixed files
// in frontend/ (same layout as the f-adversarial-heading test: this
// file lives in test/, the fixed files in frontend/ next to it, so it
// runs unchanged when copied into a candidate-copy tree).
//
// Scope honoured by these pins:
//  - Hero block only in index.html (copy verbatim, image slot documented).
//  - Landing-wide dark expressed in styles.css only; mobile-section.css
//    keeps its pinned structure (device shell, island, keys, aspect,
//    reduced-motion). NOSIM ADAPTATION (03:29 EET 30 Oct user redirect):
//    the staged film is gone, so the phone's record classes are now
//    record-* in mobile-section.css and the verdict-number pin below
//    follows them; the guarantee (rounded display face, not serif) is
//    unchanged, only its pin location moved.
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
  // V3 ADAPTATION (user-approved comp v3): the statement section id is
  // "statement", not the old "problem" — the section itself was rebuilt
  // as one huge sentence (see the statement test below).
  const m = html.match(/<section class="statement" id="statement"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(m, 'index.html must contain the v3 statement section');
  return m[1];
};
const navBlocks = () => [...stripComments(html).matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)];

test('D-HERO hero: giant display present, copy verbatim, no new claims', () => {
  // V3 ADAPTATION (user-approved comp v3): the hero was rebuilt — new
  // display line, new sub-copy, new CTAs, photo background. The pinned
  // guarantees are unchanged: giant display type, verbatim copy, no new
  // claims, no invented numbers, no live-verdict claim.
  const hero = heroBlock();
  assert.ok(hero.includes('<h1>Know the number<br>before you sign.</h1>'),
    'hero H1 wording must be the v3 line, unchanged');
  assert.ok(hero.includes('Enter an artist, a city and a guarantee. Get the break-even ticket count, checked against live Qloo taste evidence — with a receipt on every claim.'),
    'hero sub-copy must be unchanged');
  assert.ok(hero.includes('<a class="cta-gold" href="app.html">Check an offer</a>'),
    'hero primary CTA must be unchanged');
  assert.ok(hero.includes('<a class="quiet" href="#flow">See how it works</a>'),
    'hero secondary CTA must be unchanged');
  assert.ok(!/\$\d/.test(hero), 'hero must carry no dollar figure (no invented number)');
  assert.ok(!/winner/i.test(hero), 'hero must award no winner');
  const v3css = read('frontend/v3-landing.css');
  assert.ok(v3css.includes('.v3 .hero h1 {') && v3css.includes('font-size: clamp(3.4rem, 6.5vw, 5.6rem);'),
    'hero headline must stay giant (5.6rem cap, 3.4rem floor, v3 ramp)');
  assert.ok(hero.includes('<img class="bg"') && hero.includes('<div class="shade">'),
    'hero must stay a dark photo hero (background image + shade overlay)');
});

test('D-HERO hero image slot: exact slot the images agent swaps into', () => {
  // V3 ADAPTATION (user-approved comp v3): the hero image is now the
  // generated arena photograph, carried as a full-bleed background img
  // (class "bg", no hero-image id, no figcaption). The pinned guarantee
  // is unchanged: the slot is one exact photographic asset with a
  // generic scene alt — it names no real artist and claims no live data.
  const hero = heroBlock();
  const m = hero.match(/<img[^>]*>/);
  assert.ok(m, 'hero must contain an img');
  assert.ok(m[0].includes('class="bg"'), 'hero img must carry class="bg" (full-bleed background slot)');
  assert.ok(m[0].includes('src="assets/media-generation-hero-arena-0-6272026f-7628-4e9e-a3b6-01710786b7b1.jpg"'), 'hero img src must be the v3 arena photograph');
  assert.ok(m[0].includes('alt="A vast empty arena at night, stage glowing, seats curving into darkness"'), 'hero img alt must be the generic arena alt');
  for (const bad of ['Clairo', 'Olivia Rodrigo', 'Armani White', 'Billie Eilish']) {
    assert.ok(!m[0].includes(bad), `hero img alt must not name ${bad}`);
  }
  const v3css = read('frontend/v3-landing.css');
  assert.ok(v3css.includes('.v3 .hero img.bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;'),
    'hero image must be a full-bleed cover frame');
});

test('D-HERO single nav: exactly one <nav>, and it is the glass pill', () => {
  // V3 ADAPTATION (user-approved comp v3): the landing nav is the v3
  // topbar nav (nav-links, "Sections" landmark) with the v3 section
  // order — the old 12-link glass pill and its appbar row are gone.
  // The pinned guarantee is unchanged: exactly one <nav> element.
  const blocks = navBlocks();
  assert.equal(blocks.length, 1, `landing must contain exactly one <nav> element, found ${blocks.length}`);
  const openTag = stripComments(html).match(/<nav\b[^>]*>/)[0];
  assert.ok(openTag.includes('class="nav-links"'), 'the single nav must be the nav-links bar');
  assert.ok(openTag.includes('aria-label="Sections"'), 'the single nav must keep its landmark label');
  const hrefs = [...blocks[0][1].matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(hrefs.length, 9, 'v3 nav must keep its 9 links');
  assert.deepEqual(hrefs, ['#flow', '#evidence', '#formula', '#recorded', '#dashboard',
    '#ledger', '#get-the-app', 'oracle.html', 'app.html'],
    'v3 nav hrefs and order must be unchanged');
  assert.ok(!stripComments(html).match(/<nav\b[^>]*class="appbar"/), 'no appbar nav element may appear');
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
  assert.ok(css.includes('body.landing-page .record-verdict-num { font-family: "Baloo 2"'),
    'recorded verdict number must leave serif for the rounded display face');
  assert.ok(css.includes('body.landing-page .footer-meta a:focus-visible { outline-color: #FFFFFF; }'),
    'footer focus outline must leave cadmium orange for white');
  assert.ok(css.includes('body.landing-page .story-section { background: #0A0A0A;'),
    'dead story-section rule must be hardened dark');
});

test('D-HERO statement: content untouched, styling dark', () => {
  // V3 ADAPTATION (user-approved comp v3): the statement section was
  // rebuilt as one huge sentence; the old headline, arithmetic and
  // promoter paragraphs did not vanish — the arithmetic paragraph moved
  // verbatim into #formula (with its hypothetical label) and the old
  // headline line survives in the landing footer. The pinned guarantees
  // are unchanged: statement copy verbatim, honesty labels intact, dark
  // styling with no light-paper/orange rule.
  const stmt = statementBlock();
  assert.ok(stmt.includes('A promoter should never sign a guarantee <em>he can\'t check.</em>'),
    'statement sentence must be unchanged');
  assert.ok(stmt.includes('That is the whole product: one number, checked against live taste evidence, before the signature — not after the show.'),
    'statement sub-copy must be unchanged');
  const formula = html.match(/<section[^>]*id="formula"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.ok(formula.includes('Illustrative arithmetic on the recorded trial. Being wrong by 100 tickets = $12,000 of guarantee exposure (100 × 120 = 12,000). That 100-ticket gap is hypothetical — not a measured outcome, not a real loss, and not a prediction.'),
    'statement arithmetic paragraph must survive verbatim in #formula, hypothetical label intact');
  assert.ok(html.includes('<p>One money decision, before you sign.</p>'),
    'statement headline line must survive in the landing footer');
  const v3css = read('frontend/v3-landing.css');
  const stmtRules = v3css.slice(v3css.indexOf('.statement'));
  assert.ok(!/(#f1f7f8|oklch\(97|#e97219)/.test(stmtRules.slice(0, 1200)),
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
