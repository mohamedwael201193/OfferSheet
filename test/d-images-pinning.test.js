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
      const src = img.match(/src="([^"]+)"/)[1];
      assert.ok(!src.startsWith('http'), `${name}: img src must be a local asset, got ${src}`);
      assert.ok(existsSync(path.join(FRONTEND, src)), `${name}: missing asset file ${src}`);
    }
  }
});

test('d-images: every photographic img is a .webp (deploy uploads assets/*.webp)', () => {
  for (const [name, html] of [['landing', landing], ['app', app]]) {
    for (const img of imgsOf(html)) {
      const src = img.match(/src="([^"]+)"/)[1];
      assert.ok(src.endsWith('.webp'), `${name}: ${src} must be .webp`);
    }
  }
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
  assert.ok(landing.includes('Recorded example — 29 Oct 2026 trial, not a live verdict'),
    'arms caption must keep the recorded-trial label');
  assert.ok(landing.includes('2,084 tickets'), 'arms caption must keep the recorded break-even');
  assert.ok(landing.includes('stock photograph, not the trial artists'),
    'arms caption must disclose the photo is stock, not the trial artists');
});

test('d-images: the qualified receipt heading wording survives (pending f-adversarial fix)', () => {
  assert.ok(app.includes('(arithmetic and price lines excepted — see below)'),
    'app must carry the qualified receipt-heading wording');
});

test('d-images: the two inspector-classified photographic originals are kept', () => {
  // Live desktop inspection: these two collage images are already
  // photographic (paper slips photographed), so they stay — only the
  // ticket-stack collage card was a line drawing and was replaced.
  assert.ok(landing.includes('src="assets/sheet-receipt.webp"'), 'landing collage keeps sheet-receipt');
  assert.ok(landing.includes('src="assets/proof-receipts.webp"'), 'landing collage keeps proof-receipts');
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
  for (const target of ['#verdict', '#receiptSection', '#verdictSheet', '#raceSection']) {
    assert.ok(app.includes(`href="${target}"`), `app nav must still link ${target}`);
  }
});
