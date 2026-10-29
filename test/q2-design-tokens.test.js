// Q2 — design tokens of the merged stylesheet (dark cinematic language).
//
// ADAPTED BY COORDINATOR for the user-ordered dark split (landing dark
// cinematic + dashboard dark too): the palette assertions below pin the
// DARK tokens, not Q2's original light tokens. Reason stated per the
// no-silent-test-change rule: the user superseded the light dashboard
// plan with an explicit dark order, so the token test's expectations
// changed with the spec, not to make a failing tree pass — the original
// light expectations would fail a tree that is dark by order.
//
// What this file covers, per page (frontend/index.html, frontend/app.html):
//   The page's own stylesheet cascade — its <link rel="stylesheet"> files
//   in document order — defines the dark palette tokens: page near-black
//   (#0A0A0A or #111111), footer band #111111, hairlines #2A2A2A /
//   #1E1E1E, and a primary amber glow near #F59E0B (any 6-digit hex
//   within 40 per RGB channel of it, so a neighbouring amber shade
//   counts but an unrelated colour does not). It also covers the single-sans rule: the EFFECTIVE
//   heading face (last heading rule in cascade order, falling back to the
//   body face when no heading rule sets one) resolves to a sans family,
//   and the body face is sans. Variable references (var(--font-…)) are
//   resolved against the cascade's custom-property definitions.
// What this file does NOT cover:
//   Exact pixel fidelity, computed styles, contrast ratios, browser
//   rendering, live verdicts, or real devices. Presence in the cascade is
//   asserted, not a screenshot. A stylesheet that defines tokens but is
//   never linked from a page fails here by design: unlinked tokens are
//   not live on that page.
//
// STATUS — READ BEFORE RUNNING: this file is written for the POST-MERGE
// tree. It is EXPECTED TO FAIL against the pre-merge tree (which uses a
// different palette encoding and a serif display face for headings) and
// to pass after the merge lands the tokens. Do not gate the current tree
// on this file; gate the merged tree on it. The other four Q2 files pass
// on the current tree; this one is the merge gate.
//
// Cascade method note: only the LAST heading font-family declaration in
// document order is treated as effective, so a merge that keeps an old
// rule and overrides it later still passes. Rules inside @media blocks
// are excluded from the type check (media-conditional faces are a browser
// question, not a token question).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const frontendPath = (name) => fileURLToPath(new URL(`../frontend/${name}`, import.meta.url));
const read = (name) => readFileSync(frontendPath(name), 'utf8');

function pageCascade(page) {
  const html = read(page);
  const hrefs = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1])
    .concat([...html.matchAll(/<link[^>]*href="([^"]+)"[^>]*rel="stylesheet"/g)].map((m) => m[1]));
  const local = hrefs.filter((h) => !/^https?:\/\//.test(h) && h.endsWith('.css'));
  assert.ok(local.length >= 1, `${page} must link at least one local stylesheet`);
  const parts = [];
  for (const href of local) {
    const file = href.split('/').pop();
    assert.ok(existsSync(frontendPath(file)), `${page} stylesheet ${href} must exist in frontend/`);
    parts.push(read(file));
  }
  return parts.join('\n');
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function stripMedia(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const open = css.indexOf('{', at);
    if (open === -1) break;
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) break; }
    }
    i = j + 1;
  }
  return out;
}

function parseRules(css) {
  const rules = [];
  const clean = stripMedia(stripComments(css));
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: m[1].split(',').map((s) => s.trim()), decls: m[2] });
  }
  return rules;
}

function customProps(rules) {
  const props = new Map();
  for (const rule of rules) {
    for (const m of rule.decls.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      props.set(m[1].trim(), m[2].trim());
    }
  }
  return props;
}

function resolveFont(value, props, depth = 0) {
  if (value == null || depth > 5) return value || '';
  const m = value.match(/var\(\s*--([a-z0-9-]+)\s*\)/);
  if (m) {
    const def = props.get(m[1]);
    if (def == null) return value;
    return resolveFont(value.replace(m[0], def), props, depth + 1);
  }
  return value;
}

const SANS_NAMES = ['sans-serif', 'system-ui', 'ui-sans-serif', 'inter', 'geist', 'helvetica', 'arial', 'roboto', 'open sans', 'source sans', 'noto sans'];
const SERIF_NAMES = ['georgia', 'times', 'garamond', 'baskerville', 'playfair', 'merriweather', 'libre baskerville'];
function isSans(family) {
  const lower = family.toLowerCase();
  const withoutSansSerif = lower.replace(/sans-serif/g, '');
  if (/serif/.test(withoutSansSerif)) return false;
  if (SERIF_NAMES.some((name) => withoutSansSerif.includes(name))) return false;
  return SANS_NAMES.some((name) => lower.includes(name));
}

function fontFamilyOf(decls) {
  const m = decls.match(/font-family\s*:\s*([^;]+);/);
  return m ? m[1].trim() : null;
}

function effectiveFaces(cascade) {
  const rules = parseRules(cascade);
  const props = customProps(rules);
  let heading = null;
  let body = null;
  for (const rule of rules) {
    const family = fontFamilyOf(rule.decls);
    if (family == null) continue;
    const resolved = resolveFont(family, props);
    const isHeadingRule = rule.selectors.some((s) =>
      /(^|[\s>+~])h[1-6](\b|$|[:.\[])|\bheading\b/.test(s));
    const isBodyRule = rule.selectors.some((s) => ['body', 'html', 'html body'].includes(s));
    if (isHeadingRule) heading = resolved;
    if (isBodyRule) body = resolved;
  }
  return { heading: heading || body, body };
}

const AMBER = [0xf5, 0x9e, 0x0b];
function hasNearAmber(cascade) {
  const hexes = [...cascade.toLowerCase().matchAll(/#([0-9a-f]{6})\b/g)].map((m) => m[1]);
  return hexes.some((hex) => {
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return rgb.every((v, i) => Math.abs(v - AMBER[i]) <= 40);
  });
}

for (const page of ['index.html', 'app.html']) {
  test(`${page}: merged cascade defines the dark palette tokens`, () => {
    const cascade = pageCascade(page).toLowerCase();
    assert.ok(cascade.includes('#0a0a0a') || cascade.includes('#111111'),
      `${page} cascade must define page near-black (#0A0A0A or #111111)`);
    assert.ok(cascade.includes('#ffffff') || /(^|[\s:,])#fff\b/.test(cascade),
      `${page} cascade must define white text (#FFFFFF)`);
    assert.ok(cascade.includes('#2a2a2a') || cascade.includes('#1e1e1e'),
      `${page} cascade must define dark hairlines (#2A2A2A or #1E1E1E)`);
    assert.ok(hasNearAmber(cascade),
      `${page} cascade must define a primary amber glow near #F59E0B (within 40 per RGB channel)`);
  });

  test(`${page}: headings resolve to a single sans family, and so does the body`, () => {
    const { heading, body } = effectiveFaces(pageCascade(page));
    assert.ok(body != null, `${page} cascade must set a body font-family to resolve against`);
    assert.ok(isSans(body), `${page} body face must be sans, got: ${body}`);
    assert.ok(heading != null, `${page} cascade must establish an effective heading face (heading rule or body fallback)`);
    assert.ok(isSans(heading), `${page} effective heading face must be sans, got: ${heading}`);
  });
}
