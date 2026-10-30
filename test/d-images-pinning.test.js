// D-IMAGES pinning: every image referenced by landing + dashboard must exist
// as a file, no old illustration asset may be referenced, and no <img> alt or
// <figcaption> may name a real artist (stock photos carry generic captions;
// the only artist imagery allowed on the app is the dynamic Qloo image slot,
// which is created at runtime by renderHeadlinerImage and is NOT a static <img>).
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const landing = readFileSync(fileURLToPath(new URL('../frontend/index.html', import.meta.url)), 'utf8');
const app = readFileSync(fileURLToPath(new URL('../frontend/app.html', import.meta.url)), 'utf8');
const FRONTEND = fileURLToPath(new URL('../frontend/', import.meta.url));

// Banned: the 7 live-inspection illustration locations (hero blueprint,
// collage ticket-stack drawing, arms silhouettes, refusals deal sheet,
// app ticket-strip blueprint, app three-panels drawing, app glyph icons)
// PLUS the other drawn figures in pre-verdict-hidden app sections
// (formula, race lanes, depth bowl), which share the same drawn treatment.
// NOT banned: sheet-receipt.webp + proof-receipts.webp — the live desktop
// inspection classifies these two as photographs (paper slips photographed),
// so they are retained originals, not illustrations (see REPORT §1).
const OLD_EDITORIAL = [
  'hero-plan.webp', 'race-ticket-stack.webp', 'arms-showcase.webp',
  'refusal-proof.webp', 'sheet-ticket.webp', 'proof-formula.webp',
  'proof-steps.webp', 'proof-race.webp', 'depth-bowl-detail.webp',
  'icon-chart.webp', 'icon-venue.webp', 'icon-ticket.webp', 'icon-contract.webp',
];

const imgsOf = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const captionsOf = (html) => [...html.matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((m) => m[1]);

test('d-images: no old illustration asset is referenced by landing or dashboard', () => {
  for (const old of OLD_EDITORIAL) {
    // Match the exact src attribute: photo-icon-*.webp legitimately contains
    // 'icon-*.webp' as a substring and must NOT trip this ban.
    assert.ok(!landing.includes(`src="assets/${old}"`), `landing must not reference ${old}`);
    assert.ok(!app.includes(`src="assets/${old}"`), `app must not reference ${old}`);
  }
});

test('d-images: every referenced asset file exists on disk', () => {
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    for (const img of imgsOf(html)) {
      // D-VERDICT-IMAGE merge: the verdict headliner slot is a src-less
      // <img id="headlinerImageImg"> filled at runtime by app.js (never a
      // placeholder asset) — it references no file, so it is skipped here
      // and pinned separately below as the ONLY src-less img allowed.
      const m = img.match(/src="([^"]+)"/);
      if (!m) continue;
      const src = m[1];
      assert.ok(!src.startsWith('http'), `${name}: img src must be a local asset, got ${src}`);
      assert.ok(existsSync(path.join(FRONTEND, src)), `${name}: missing asset file ${src}`);
    }
  }
});

test('d-images: every photographic img is a .webp (deploy uploads assets/*.webp)', () => {
  // V3 ADAPTATION (user-approved comp v3): the landing hero and crowd
  // band are generated JPG photographs, not .webp — the old
  // ".webp-only" rule was a deploy-upload assumption, and no
  // .webp-only upload glob exists anywhere in this tree (vercel.json
  // only rewrites /api/*; Vercel serves the whole frontend dir). The
  // pinned guarantee is unchanged and tightened: every img src must be
  // a local photographic file (.webp, .jpg or .jpeg) that exists on
  // disk, and the JPG set must be exactly the two v3 generated photos
  // — no other JPG may creep in.
  const jpgs = [];
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    for (const img of imgsOf(html)) {
      const m = img.match(/src="([^"]+)"/);
      if (!m) continue;
      const src = m[1];
      assert.ok(src.endsWith('.webp') || src.endsWith('.jpg') || src.endsWith('.jpeg'), `${name}: ${src} must be .webp/.jpg/.jpeg`);
      if (/\.jpe?g$/.test(src)) jpgs.push(src);
    }
  }
  assert.deepEqual(jpgs.sort(), [
    'assets/media-generation-crowd-night-0-81896dc0-7799-4319-a6be-0c499ebf9ac2.jpg',
    'assets/media-generation-hero-arena-0-6272026f-7628-4e9e-a3b6-01710786b7b1.jpg',
  ], 'the only JPGs in the product must be the two v3 generated photographs');
});

test('d-images: no img alt or figcaption names a real artist', () => {
  // Names that appear elsewhere on the pages as recorded-trial data (arm
  // picks, trial ledger) — they must never appear as a photo caption/alt,
  // because the photos are stock, not pictures of those artists.
  const FORBIDDEN = ['Clairo', 'Olivia Rodrigo', 'Armani White', 'Billie Eilish'];
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    for (const img of imgsOf(html)) {
      const alt = img.match(/alt="([^"]*)"/)?.[1] ?? '';
      for (const bad of FORBIDDEN) assert.ok(!alt.includes(bad), `${name}: alt names ${bad}: ${alt}`);
    }
    for (const cap of captionsOf(html)) {
      for (const bad of FORBIDDEN) assert.ok(!cap.includes(bad), `${name}: caption names ${bad}: ${cap}`);
    }
  }
});

test('d-images: the only src-less img is the runtime-filled verdict headliner slot', () => {
  const srcless = imgsOf(app).filter((img) => !/src="/.test(img));
  assert.equal(srcless.length, 1, `exactly one src-less img allowed in app, got ${srcless.length}`);
  assert.ok(srcless[0].includes('id="headlinerImageImg"'), 'the src-less img must be the headliner slot');
  assert.ok(app.includes('<figure id="headlinerImage" class="headliner-image" hidden>'), 'headliner figure must exist, hidden by default');
});

test('d-images: no caption or alt describes a drawing, proof paper, or baked-in numbers', () => {
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    for (const img of imgsOf(html)) {
      const alt = img.match(/alt="([^"]*)"/)?.[1] ?? '';
      assert.ok(!/proof paper|drawing|drawn/i.test(alt), `${name}: stale drawing alt: ${alt}`);
    }
    for (const cap of captionsOf(html)) {
      assert.ok(!/proof paper|baked into/i.test(cap), `${name}: stale drawing caption: ${cap}`);
    }
  }
});

test('d-images: arms figure still labels the recorded trial (never live) and discloses stock', () => {
  // V3 ADAPTATION (user-approved comp v3): the old arms <figure> and
  // its caption are gone — the arms section is now a runtime tally and
  // the recorded trials live in the #recorded band. The pinned
  // guarantees are unchanged and are asserted where v3 carries them:
  // (1) recorded content is labeled recorded, never live; (2) the
  // recorded break-even is present; (3) photographs are disclosed as
  // generic scenes, never captioned as real artists.
  const arms = landing.match(/<section[^>]*id="arms"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.ok(arms.includes('Recorded, not live'), 'arms section must keep the recorded-not-live label');
  assert.ok(arms.includes('computed from the recorded trial pack'), 'arms tally must disclose it is computed from the pack, not typed in');
  const recorded = landing.match(/<section[^>]*id="recorded"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.ok(recorded.includes('2,084'), 'recorded band must keep the recorded break-even');
  assert.ok(recorded.includes('Recorded · Trial'), 'recorded band must label its trials recorded');
  assert.ok(landing.includes('Evidence photographs are generic scenes — never captioned as a real artist.'),
    'evidence caption must disclose the photos are generic scenes, not the trial artists');
});

test('d-images: the qualified receipt heading wording survives (pending f-adversarial fix)', () => {
  assert.ok(app.includes('(arithmetic and price lines excepted — see below)'),
    'app must carry the qualified receipt-heading wording');
});

test('d-images: the two inspector-classified photographic originals are kept', () => {
  // Live desktop inspection: these two collage images are already
  // photographic (paper slips photographed), so they stay — only the
  // ticket-stack collage card was a line drawing and was replaced.
  // V3 ADAPTATION (user-approved comp v3): the landing collage section
  // itself is gone (replaced by the evidence/recorded sections), so the
  // originals are no longer referenced by the landing — but they must
  // not be silently dropped from the product: both files still ship in
  // assets/ and both are still referenced by the app (receipts +
  // depth), which is where they are still shown.
  assert.ok(existsSync(path.join(FRONTEND, 'assets/sheet-receipt.webp')), 'sheet-receipt must still ship in assets/');
  assert.ok(existsSync(path.join(FRONTEND, 'assets/proof-receipts.webp')), 'proof-receipts must still ship in assets/');
  assert.ok(app.includes('src="assets/sheet-receipt.webp"'), 'app receipts keeps sheet-receipt');
  assert.ok(app.includes('src="assets/proof-receipts.webp"'), 'app depth keeps proof-receipts');
});

test('d-images: section-head glyphs are dark photographs, not light-paper line icons', () => {
  // Refinement: glyphs beside section headings must be photographic imagery
  // (or clean typographic marks) fitting the dark theme — light-paper line
  // drawings clash with the dark dashboard and do not count as fixed.
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    assert.ok(!html.includes('src="assets/icon-'), `${name}: no light-paper glyph icon may remain`);
  }
  for (const icon of ['photo-icon-ticket.webp', 'photo-icon-chart.webp', 'photo-icon-venue.webp', 'photo-icon-contract.webp']) {
    assert.ok(app.includes(`src="assets/${icon}"`), `app must use ${icon} as a section-head mark`);
  }
});

test('d-images: dashboard nav targets untouched (pending f-a11y-nav fix owns nav)', () => {
  // This batch touches only <img> src/alt and <figcaption>/fallback text.
  // It must not add, remove, or rename any nav anchor target.
  // V3 ADAPTATION (user-approved comp v3, five-destination sidebar):
  // the nav itself was intentionally cut to five destinations by the v3
  // rebuild, so "nav targets untouched" now means: the one verdict
  // link the nav keeps (#verdict) is untouched in its inert-but-
  // explained form, and the three retired subsection targets still
  // exist as section ids (not renamed or dropped) — they are reached
  // via #verdict, not by separate nav links. The nav-target inventory
  // itself is pinned by d-sidebar-pinning.
  const nav = app.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.ok(nav.includes('href="#verdict"'), 'app nav must still link #verdict');
  for (const target of ['receiptSection', 'verdictSheet', 'raceSection']) {
    assert.ok(!nav.includes(`href="#${target}"`), `v3 app nav must not link #${target} (five-destination sidebar)`);
    assert.ok(app.includes(`id="${target}"`), `#${target} section must still exist in app.html (not renamed or dropped)`);
  }
});
