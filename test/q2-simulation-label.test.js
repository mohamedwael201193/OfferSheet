// Q2 — landing phone recorded label (no live app inside the phone).
//
// 03:29 EET 30 Oct user redirect: the staged film is out of the shipped
// product. The phone now shows a STATIC record of the real 29 Oct 2026
// trial verdict only — no staged frames, no staged-film script or
// stylesheet, no staged-film wording. This file re-pins the label and
// the no-embed guarantees against the new static phone, and pins the
// absence of the removed staged-film markup.
//
// What this file covers (frontend/index.html, phone section only):
//   (1) The phone section carries the verbatim label
//       "Recorded demo — 29 Oct 2026 trial, not a live verdict", on an
//       element of its own, INSIDE the phone screen, so the recording
//       disclaimer is persistent and visible with the phone, not buried
//       below it. (2) The phone shows the static recorded verdict:
//       2,084 tickets, Billie Eilish, New York, $250,000 ÷ $120.
//       (3) No iframe, embed, or object element exists inside the phone
//       section, and no app-page source is embedded there (an
//       <a href="app.html"> link to the real app is a route, not an
//       embed, and is explicitly allowed). (4) No staged-film markup
//       remains: no staged frames, no filmstrip container, no staged
//       script/stylesheet reference.
// What this file does NOT cover:
//   Browser rendering, live verdicts, or real devices. Static markup
//   only: a label injected only at runtime by JavaScript would fail
//   here by design, because the disclaimer must be present before any
//   script runs.
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
  assert.ok(section.includes('class="record-label"'), 'the label must live on its own labelled element');
});

test('phone section label sits inside the phone screen', () => {
  const section = phoneSection();
  const screenAt = section.indexOf('class="ms-screen"');
  const labelAt = section.indexOf(LABEL, screenAt);
  const homebarAt = section.indexOf('ms-homebar', screenAt);
  assert.ok(screenAt !== -1, 'device screen (exact class token ms-screen) must exist in the phone section');
  assert.ok(labelAt !== -1, 'label must exist in the phone section');
  assert.ok(homebarAt !== -1, 'home bar must exist after the screen');
  assert.ok(screenAt < labelAt && labelAt < homebarAt,
    'the label must sit inside the phone screen, not outside the device frame');
  const deviceAt = classTokenIndex(section, 'ms-device');
  assert.ok(deviceAt !== -1 && deviceAt < labelAt, 'the label must sit inside the device frame');
});

test('phone shows the static recorded verdict, not a live claim', () => {
  const section = phoneSection();
  assert.ok(section.includes('2,084'), 'phone must show the recorded break-even 2,084');
  assert.ok(section.includes('Billie Eilish') && section.includes('New York')
    && section.includes('$250,000') && section.includes('$120'),
    'phone must carry the recorded trial inputs');
  assert.ok(section.includes('$250,000 ÷ $120'), 'phone must show the recorded formula division');
  assert.ok(section.includes('not a live verdict'), 'phone must state the record is not live');
  assert.ok(!section.toLowerCase().includes('running live'), 'phone must not claim to run live');
});

test('phone carries no staged-film markup', () => {
  const section = phoneSection();
  assert.ok(!section.includes('Frame 1 of 3') && !section.includes('Frame 3 of 3'),
    'phone must carry no staged frames');
  assert.ok(!section.includes('class="frames"'), 'phone must carry no filmstrip container');
  assert.ok(!section.includes('sim-animation'), 'phone section must not reference the removed staged-film files');
  assert.ok(!/sim-/.test(section), 'phone section must carry no staged-film class markup');
  assert.ok(!section.includes('id="simStage"') && !section.includes('id="simPause"'),
    'phone must carry no staged-film control ids');
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
  // with the staged film would also pass the embed test while breaking
  // the page.
  const section = phoneSection();
  assert.ok(section.includes('href="app.html"') || section.includes("href='app.html'"),
    'phone section must keep a plain link to the real app');
});
