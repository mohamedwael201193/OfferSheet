// J2 second-round blocker (program-30 fix agent F-ADVERSARIAL-HEADING).
// The receipt-section summary heading in frontend/app.html stated, unqualified,
// "Every Qloo-backed claim carries a receipt — and every receipt re-runs",
// while the body directly below it concedes arithmetic and price lines carry
// no receipt by design and no-ID legs replay as not comparable. This file pins
// the qualified heading and the unchanged body concession. It changes no
// existing test and weakens no pinned requirement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('J2 heading: receipt summary heading carries the arithmetic/price exception', () => {
  const html = read('frontend/app.html');
  assert.ok(
    html.includes('<summary>Every Qloo-backed claim carries a receipt — and every receipt re-runs (arithmetic and price lines excepted — see below)</summary>'),
    'qualified heading text must be present verbatim',
  );
});

test('J2 heading: no unqualified receipt summary heading remains', () => {
  const html = read('frontend/app.html');
  assert.ok(
    !html.includes('<summary>Every Qloo-backed claim carries a receipt — and every receipt re-runs</summary>'),
    'the bare <summary> heading must not remain anywhere',
  );
});

test('J2 heading: body concession below the heading is unchanged', () => {
  const html = read('frontend/app.html');
  assert.ok(
    html.includes('Arithmetic and price lines carry no receipt by design — their inputs are labelled by source instead.'),
    'body must still concede arithmetic/price lines carry no receipt by design',
  );
  assert.ok(
    html.includes('legs whose results carry no IDs replay as not comparable, never as a match'),
    'body must still concede no-ID legs replay as not comparable',
  );
});

test('J2 heading: heading sits in the receipt note block, body directly below it', () => {
  const html = read('frontend/app.html');
  const noteAt = html.indexOf('id="depthReceiptNote"');
  const headingAt = html.indexOf('(arithmetic and price lines excepted — see below)</summary>', noteAt);
  const concessionAt = html.indexOf('Arithmetic and price lines carry no receipt by design', headingAt);
  assert.ok(noteAt !== -1 && headingAt !== -1 && concessionAt !== -1, 'heading and concession must both sit inside the receipt note block, heading first');
  assert.ok(headingAt > noteAt && concessionAt > headingAt, 'order: receipt note block, qualified heading, body concession');
});
