// D-VOID: the landing Statement section (#statement in v3) must read as
// substantive content, not a theatrical void. Every number, pick and timing
// in the fill is taken from the candidate's own frontend/trial-pack.json —
// nothing invented, nothing filler. Data-driven: the test re-derives each
// marker from the pack, so a pack change fails loudly instead of silently
// drifting.
//
// V3 ADAPTATION (user-approved comp v3): the old #problem section — one
// giant line plus three static receipt cards carrying full trial SHA-256
// hashes — was rebuilt. The statement is now one huge sentence; the
// substantive recorded content lives in the #recorded band (three trials,
// pack-derived, static) and the #arms tally (computed at runtime from the
// same pack); replay hashes live in the #evidence proof strip (full
// SHA-256 call-arg hashes for the Billie trial). The guarantees are
// unchanged: substantive, pack-derived, labeled recorded-not-live, no
// filler, no invented numbers — asserted where v3 carries each piece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'), 'utf8');
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend', 'trial-pack.json'), 'utf8'));

const sectionOf = (id) => {
  const m = html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/section>`));
  assert.ok(m, `landing must contain #${id}`);
  return m[1];
};
const statement = sectionOf('statement');
const recorded = sectionOf('recorded');
const arms = sectionOf('arms');
const evidence = sectionOf('evidence');
const formula = sectionOf('formula');
const fmt = (n) => n.toLocaleString('en-US');

const shortName = (pick) => {
  // First sentence fragment: cut at '.' or ' —', whichever comes first.
  const cut = Math.min(
    ...['.', ' —'].map((sep) => (pick.indexOf(sep) >= 0 ? pick.indexOf(sep) : Infinity)),
  );
  return cut === Infinity ? pick.trim() : pick.slice(0, cut).trim();
};
const isDecline = (pick) => /cannot be selected/i.test(pick);

test('d-void: statement keeps its original line and honesty paragraphs', () => {
  // V3: the statement sentence is new, but the old honesty copy survives
  // in its new homes — the arithmetic paragraph (hypothetical label
  // intact) in #formula, the old headline line in the landing footer.
  assert.match(statement, /A promoter should never sign a guarantee/);
  assert.match(statement, /That is the whole product: one number, checked against live taste evidence, before the signature/);
  assert.match(formula, /That 100-ticket gap is hypothetical/);
  assert.match(html, /One money decision, before you sign\./);
});

test('d-void: statement holds exactly 3 recorded-trial receipt cards', () => {
  // V3: the three static receipt cards became the three #recorded trial
  // entries — same count, same pack, same guarantee (nothing invented).
  const cards = recorded.match(/Recorded · Trial/g) || [];
  assert.equal(cards.length, 3);
  assert.equal(pack.trials.length, 3);
});

test('d-void: every receipt card carries its trial-pack numbers, picks, timing and hash', () => {
  // V3: numbers/picks/timing are re-derived from the pack against the
  // static #recorded band; hashes moved to the #evidence proof strip
  // (full SHA-256 call-arg hashes for the Billie trial, the recorded
  // band's trial 1) and to trial-pack.json itself (per-trial sha256,
  // the file the app and oracle replay from) — replayability is pinned
  // on both surfaces, not silently dropped.
  for (const trial of pack.trials) {
    const { artist, city, guarantee, ticketPrice } = trial.inputs;
    assert.ok(recorded.includes(fmt(trial.breakEvenTickets)), `break-even ${trial.breakEvenTickets}`);
    assert.ok(recorded.includes(artist), artist);
    assert.ok(recorded.includes(city), city);
    assert.ok(recorded.includes(`$${fmt(guarantee)} / $${fmt(ticketPrice)}`), 'guarantee/price');
    assert.ok(recorded.includes(`${(trial.timingMs / 1000).toFixed(1)}s`), 'timing');
    assert.ok(recorded.includes(trial.graphPick), `graph ${trial.graphPick}`);
    assert.ok(recorded.includes(shortName(trial.gutPick)), `gut ${shortName(trial.gutPick)}`);
    if (isDecline(trial.webPick)) {
      assert.ok(recorded.includes('could not select'), 'declined web pick must be labeled as not selecting');
    } else {
      assert.ok(recorded.includes(shortName(trial.webPick)), `web ${shortName(trial.webPick)}`);
    }
    assert.ok(typeof trial.sha256 === 'string' && trial.sha256.length >= 32, `pack trial sha256 present for ${artist}`);
  }
  for (const full of [
    'affa6e35703be8f54ddeec84c42966a06093e94f21082f4cd446ada31f7f93f7',
    'ca25e61f063d761de30b8d2378b3fa94a15520e3f51f2d681fa78e98f5f3bc4b',
    '300b829594a73e7e81960ee7a913b4e258610d8a1a70fe903fad57bff1a53cfc',
  ]) assert.ok(evidence.includes(full), `proof strip must carry full hash ${full.slice(0, 8)} for replay`);
});

test('d-void: fill is labelled recorded-not-live, never presented as live', () => {
  // D1-B: labels live on the #recorded band and the #arms tally. The
  // arms tally is a STATIC paragraph, computed from trial-pack.json at
  // patch time and pinned by recomputation in phase3-oracle S1. No
  // runtime fetch, no unavailable fallback beside a static number; the
  // static string itself is the pin.
  const labels = (recorded.match(/Recorded/g) || []).length + (arms.match(/Recorded/g) || []).length;
  assert.ok(labels >= 2, `expected >=2 recorded labels, got ${labels}`);
  assert.match(recorded, /never presented as live/);
  assert.ok(arms.includes('Qloo changed the pick in 3 of 3 recorded trials.'), 'arms static tally must state the pack-computed 3 of 3');
  assert.ok(arms.includes('at patch time'), 'arms static tally must state patch-time computation');
  assert.ok(!arms.includes("fetch('trial-pack.json')"), 'static tally must not fetch at runtime');
  assert.ok(!arms.includes('Recorded tally unavailable'), 'no unavailable fallback beside a static number');
  assert.doesNotMatch(html, /a live verdict on this page|computed live/i);
});

test('d-void: no filler placeholders in the filled section', () => {
  for (const filler of ['Lorem', 'TODO', 'placeholder', 'coming soon', 'XXX', 'TBD']) {
    assert.ok(!statement.toLowerCase().includes(filler.toLowerCase()), `filler found in statement: ${filler}`);
    assert.ok(!recorded.toLowerCase().includes(filler.toLowerCase()), `filler found in recorded: ${filler}`);
  }
});

test('d-void: styles cap the giant line and lay receipts out in 3 columns (1 on narrow)', () => {
  assert.match(css, /\.statement \{ padding-top: 96px; padding-bottom: 96px; \}/);
  assert.match(css, /\.statement \.display--giant \{ font-size: clamp\(48px, 8vw, 96px\); \}/);
  assert.match(css, /\.statement-receipts \{ display: grid; grid-template-columns: repeat\(3, 1fr\);/);
  assert.match(css, /\.statement-receipts \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.statement-receipt \{ border: 1px solid var\(--hair\);/);
  // No motion on the new content: nothing in the statement rules animates.
  const stmtCss = css.slice(css.indexOf('.statement .display--giant'));
  assert.doesNotMatch(stmtCss.slice(0, 2200), /animation:/);
});

test('d-void: statement tally matches the pack misses (3/3 changed, 3/3 gut, 2/3 web + 1/3 declined)', () => {
  // D1-B: the tally sentence is STATIC text, computed from the pack at
  // patch time (the runtime arms script is gone by design). The
  // guarantee is pinned two ways: (1) the pack itself re-derives to
  // 3/3 changed, 3/3 gut, 2/3 web-picked-differently + 1/3 declined,
  // and (2) the landing's static tally string equals that recomputation
  // (the same recomputation is asserted in phase3-oracle S1).
  const missed = (t, arm) => (t.misses || []).some((m) => m.arm === arm);
  const changed = pack.trials.filter((t) => missed(t, 'gut') || missed(t, 'web')).length;
  const gut = pack.trials.filter((t) => missed(t, 'gut')).length;
  const webPicked = pack.trials.filter((t) => missed(t, 'web') && !isDecline(t.webPick)).length;
  const webDeclined = pack.trials.filter((t) => missed(t, 'web') && isDecline(t.webPick)).length;
  assert.equal(changed, 3);
  assert.equal(gut, 3);
  assert.equal(webPicked, 2);
  assert.equal(webDeclined, 1);
  assert.ok(arms.includes(`Qloo changed the pick in ${changed} of ${pack.trials.length} recorded trials.`),
    'landing static tally must equal the pack recomputation');
  assert.ok(arms.includes('at patch time'),
    'static tally must state it was computed at patch time');
  assert.ok(arms.includes('Qloo changed the pick in some recorded trials'),
    'arms static text must describe the tally without asserting its number');
});
