// D-FORMULA pinning test (program-30, filing day).
// Defect: the landing "Formula" section read as a large black rectangle
// with no visible content — its only diagram was a scroll-drawn SVG
// that was invisible until its observer fired (dashoffset 100, then a
// 1.2s draw) and, once drawn, was an unlabeled step line that explained
// nothing, inside a near-black slab with 96px of padding at each end.
// Fix branch (this test's expectation): the section KEEPS its real
// content and renders it statically — labeled parts, worked numbers,
// rounding note — with the draw mechanism fully removed, so the section
// can never again present as an empty black box. If the section were
// ever removed instead, this test's removal branch requires zero
// dangling href="#formula" references anywhere in the frontend tree.
// Numbers below are the page's own recorded-trial figures (also stated
// in the adjacent stats/ledger sections); no new data is introduced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');

function readFrontend(name) {
  return fs.readFileSync(path.join(FRONTEND, name), 'utf8');
}

function frontendFiles() {
  return fs.readdirSync(FRONTEND)
    .filter((f) => /\.(html|css|js)$/.test(f))
    .map((f) => ({ name: f, text: readFrontend(f) }));
}

function formulaSection(html) {
  const m = html.match(/<section[^>]*id="formula"[^>]*>([\s\S]*?)<\/section>/);
  return m ? m[1] : null;
}

test('formula section shows real content statically, or is absent with zero dangling refs', () => {
  const indexHtml = readFrontend('index.html');
  const section = formulaSection(indexHtml);
  const files = frontendFiles();
  if (section === null) {
    // Removal branch: no file may link to an anchor that no longer exists.
    for (const f of files) {
      assert.ok(!/href="#formula"/.test(f.text), `${f.name} links to removed #formula`);
    }
    return;
  }
  // Fix branch: labeled parts + worked numbers + rounding note, all in
  // static markup (no SVG, no canvas, no JS-driven drawing).
  // V3 ADAPTATION (user-approved comp v3): the formula section keeps
  // every worked number but labels them in v3's shorter wording —
  // "Ticket $120" (not "Ticket price") and "= 2,084 tickets" (not
  // "Tickets to break even"). The guarantee is unchanged: labeled
  // parts, worked numbers, rounding note, all static.
  for (const marker of ['Guarantee', 'Ticket $120', '2,084 tickets',
    '$250,000', '$120', '2,083.33', '2,084', 'rounded up']) {
    assert.ok(section.includes(marker), `formula section missing marker: ${marker}`);
  }
  assert.ok(!/<svg|<canvas/.test(section), 'formula section must not depend on SVG/canvas rendering');
});

test('scroll-draw diagram mechanism is fully gone from landing files', () => {
  for (const name of ['index.html', 'styles.css', 'landing.js']) {
    const text = readFrontend(name);
    for (const token of ['draw-svg', 'draw-path', 'js-draw', 'stroke-dashoffset']) {
      assert.ok(!text.includes(token), `${name} still contains draw mechanism token: ${token}`);
    }
  }
});

test('formula section has no animation or transition (reduced-motion safe by construction)', () => {
  const css = readFrontend('styles.css');
  const block = css.match(/\.formula-strip \{[^}]*\}/);
  assert.ok(block, 'no .formula-strip rule');
  assert.ok(!/animation|transition/.test(block[0]), '.formula-strip must not animate');
  const breakdown = css.match(/\.formula-breakdown \{[^}]*\}/);
  assert.ok(breakdown, 'no .formula-breakdown rule');
  assert.ok(!/animation|transition/.test(breakdown[0]), '.formula-breakdown must not animate');
});

test('every href="#formula" in the frontend tree resolves to an id="formula" in the same file', () => {
  for (const f of frontendFiles()) {
    if (!/\.html$/.test(f.name)) continue;
    const links = (f.text.match(/href="#formula"/g) || []).length;
    const targets = (f.text.match(/id="formula"/g) || []).length;
    assert.ok(links === 0 || targets >= 1, `${f.name} has ${links} #formula link(s) but no #formula target`);
  }
});

test('formula section keeps its nav anchor and dark-language contrast tokens', () => {
  const indexHtml = readFrontend('index.html');
  assert.ok(indexHtml.includes('<a href="#formula">Formula</a>'), 'landing nav #formula link missing');
  const css = readFrontend('styles.css');
  assert.ok(css.includes('.formula-value') && css.includes('color: var(--text)'),
    'formula values must use the dark-language text token');
  assert.ok(css.includes('.formula-role') && css.includes('color: var(--muted)'),
    'formula role labels must use the muted token');
});
