// Q2 — landing phone simulation label (no live app inside the phone).
//
// What this file covers (frontend/index.html, phone section only):
//   (1) The phone section carries the verbatim label
//       "Recorded demo — 29 Oct 2026 trial, not a live verdict", on an
//       element of its own, positioned before the phone device frame, so
//       the recording disclaimer is persistent and visible with the phone,
//       not buried below it. (2) No iframe, embed, or object element exists
//       inside the phone section, and no app-page source is embedded there
//       (an <a href="app.html"> link to the real app is a route, not an
//       embed, and is explicitly allowed).
// What this file does NOT cover:
//   Browser rendering, animation playback, autoplay behaviour, live
//   verdicts, real devices, or whether the animation frames match the
//   recorded trial numbers (that is the animation script's own test
//   surface). Static markup only: a label injected only at runtime by
//   JavaScript would fail here by design, because the disclaimer must be
//   present before any script runs.
//
// Method note: the phone section is scoped from the section element that
// carries id="get-the-app" to its closing </section>. The device frame is
// located by an exact class token "ms-device": a plain substring search
// would false-match a differently-named figure class that merely starts
// with the same characters, so class attributes are split on whitespace
// and matched token-for-token.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const landing = readFileSync(fileURLToPath(new URL('../frontend/index.html', import.meta.url)), 'utf8');
const LABEL = 'Recorded demo — 29 Oct 2026 trial, not a live verdict';

function phoneSection() {
  const start = landing.indexOf('id="get-the-app"');
  assert.notEqual(start, -1, 'landing must contain the phone section (id="get-the-app")');
  const sectionOpen = landing.lastIndexOf('<section', start);
  assert.notEqual(sectionOpen, -1, 'phone section must open with a <section> element');
  const end = landing.indexOf('</section>', start);
  return end === -1 ? landing.slice(sectionOpen) : landing.slice(sectionOpen, end);
}

// Index of the first element whose class list contains exactly `token`.
function classTokenIndex(html, token) {
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    if (m[1].split(/\s+/).includes(token)) return m.index;
  }
  return -1;
}

test('phone section carries the recorded-demo label verbatim, on its own element', () => {
  const section = phoneSection();
  assert.ok(section.includes(LABEL), 'phone section must carry the recorded label verbatim');
  assert.ok(section.includes('class="sim-label"'), 'the label must live on its own labelled element');
});

test('phone section label sits before the device frame', () => {
  const section = phoneSection();
  const labelAt = section.indexOf(LABEL);
  const deviceAt = classTokenIndex(section, 'ms-device');
  assert.ok(labelAt !== -1, 'label must exist in the phone section');
  assert.ok(deviceAt !== -1, 'device frame (exact class token ms-device) must exist in the phone section');
  assert.ok(labelAt < deviceAt, 'the label must sit on or above the device frame, not below it');
});

test('phone section embeds nothing: no iframe, embed, or object', () => {
  const section = phoneSection();
  for (const tag of ['<iframe', '<embed', '<object']) {
    assert.ok(!section.toLowerCase().includes(tag), `phone section must not contain ${tag}`);
  }
  assert.ok(!section.includes('src="app.html"'), 'phone section must not embed the app page as a source');
  assert.ok(!section.includes("src='app.html'"), 'phone section must not embed the app page as a source');
});

test('phone section still routes to the real app by link, not by embed', () => {
  // Guard against an over-broad fix: removing the live-demo route along
  // with the embed would also pass the embed test while breaking the page.
  const section = phoneSection();
  assert.ok(section.includes('href="app.html"') || section.includes("href='app.html'"),
    'phone section must keep a plain link to the real app');
});
