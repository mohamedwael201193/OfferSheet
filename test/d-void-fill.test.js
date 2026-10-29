// D-VOID: the landing Statement section (#problem) must read as substantive
// content, not a theatrical void. Every number, pick, timing and hash in the
// fill is taken from the candidate's own frontend/trial-pack.json — nothing
// invented, nothing filler. Data-driven: the test re-derives each marker
// from the pack, so a pack change fails loudly instead of silently drifting.
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

const statement = html.slice(html.indexOf('id="problem"'));
const section = statement.slice(0, statement.indexOf('</section>'));
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
  assert.match(section, /One money decision, before you sign\./);
  assert.match(section, /That 100-ticket gap is hypothetical/);
  assert.match(section, /A promoter signs a guarantee with a number in mind/);
});

test('d-void: statement holds exactly 3 recorded-trial receipt cards', () => {
  const cards = section.match(/<article class="statement-receipt">/g) || [];
  assert.equal(cards.length, 3);
  assert.equal(pack.trials.length, 3);
});

test('d-void: every receipt card carries its trial-pack numbers, picks, timing and hash', () => {
  for (const trial of pack.trials) {
    const { artist, city, guarantee, ticketPrice } = trial.inputs;
    assert.ok(section.includes(fmt(trial.breakEvenTickets)), `break-even ${trial.breakEvenTickets}`);
    assert.ok(section.includes(artist), artist);
    assert.ok(section.includes(city), city);
    assert.ok(section.includes(`$${fmt(guarantee)} / $${fmt(ticketPrice)}`), 'guarantee/price');
    assert.ok(section.includes(`${(trial.timingMs / 1000).toFixed(1)}s`), 'timing');
    assert.ok(section.includes(trial.graphPick), `graph ${trial.graphPick}`);
    assert.ok(section.includes(shortName(trial.gutPick)), `gut ${shortName(trial.gutPick)}`);
    if (isDecline(trial.webPick)) {
      assert.match(section, /Declined to pick/);
    } else {
      assert.ok(section.includes(shortName(trial.webPick)), `web ${shortName(trial.webPick)}`);
    }
    assert.ok(section.includes(trial.sha256), 'full trial SHA-256 present, not a prefix');
  }
});

test('d-void: fill is labelled recorded-not-live, never presented as live', () => {
  const labels = section.match(/Recorded, not live/g) || [];
  assert.ok(labels.length >= 2, `expected >=2 recorded labels, got ${labels.length}`);
  assert.match(section, /this page computes nothing/);
  assert.doesNotMatch(section, /a live verdict on this page|computed live/i);
});

test('d-void: no filler placeholders in the filled section', () => {
  for (const filler of ['Lorem', 'TODO', 'placeholder', 'coming soon', 'XXX', 'TBD']) {
    assert.ok(!section.toLowerCase().includes(filler.toLowerCase()), `filler found: ${filler}`);
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
  const changed = pack.trials.filter((t) => t.misses.length > 0).length;
  assert.equal(changed, 3);
  assert.match(section, /Qloo changed the pick in 3\/3 trials\. Gut differed in 3\/3\. Web picked differently in 2\/3 and declined to pick in 1\/3\. Recorded, not live\./);
});
