// Verdict artist image — pinning test for the d-verdict-image fix.
//
// Contract pinned here (behavioral, not string-matching alone: the real
// renderHeadlinerImage + qlooHeadlinerImageUrl are extracted from
// frontend/app.js and executed against a minimal DOM shim):
//  1. A Qloo-hosted image on the matched headliner renders, in ANY field
//     shape Qloo carries it (headliner.image, properties.image.url,
//     properties.image string, imageUrl/image_url).
//  2. A REST-hydrated entity whose id IS the headliner's id also renders
//     (previously dropped: the old renderer read headliner.image only).
//  3. No image anywhere -> the static slot stays hidden, src cleared.
//     NEVER a placeholder, NEVER a generic photo captioned as the artist.
//  4. A non-Qloo host is never rendered (the "Image: Qloo" caption must
//     stay truthful); http is rejected; another entity's image is never
//     used, even by name match — id match only.
//  5. A failed load hides the slot and clears its src (error-remove).
//  6. The static slot exists in app.html, hidden by default, captioned
//     exactly "Image: Qloo"; dashboard.css hides [hidden] and caps the
//     image at 100% width at 390px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const appJs = readFileSync(fileURLToPath(new URL('../frontend/app.js', import.meta.url)), 'utf8');
const appHtml = readFileSync(fileURLToPath(new URL('../frontend/app.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../frontend/dashboard.css', import.meta.url)), 'utf8');

const QLOO_IMG = 'https://images.qloo.com/i/test-entity-billie-420x-auto.jpg';
const QLOO_IMG_2 = 'https://qloo.com/i/test-entity-billie.jpg';

// Extract one top-level function by brace counting.
function extract(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `app.js must define ${name}`);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.alt = '';
    this.onerror = null;
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  insertBefore(c, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i >= 0) this.children.splice(i, 0, c); else this.children.push(c);
    c.parentNode = this; return c;
  }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    }
  }
  removeAttribute(name) { if (name === 'src') delete this.src; }
  querySelector(sel) {
    const want = sel.toLowerCase();
    const walk = (el) => {
      for (const c of el.children) {
        if (c.tagName.toLowerCase() === want) return c;
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
}

function buildContext() {
  const byId = new Map();
  const document = {
    createElement: (tag) => new El(tag),
    getElementById: (id) => byId.get(id) || null,
  };
  const sandbox = {
    document,
    URL,
    console,
  };
  sandbox.$ = (id) => document.getElementById(id);
  const code = [
    'qlooImageUrlFromEntity', 'qlooHeadlinerImageUrl',
    'figureImage', 'figureCaption', 'hideHeadlinerFigure', 'renderHeadlinerImage',
  ].map((n) => extract(appJs, n)).join('\n');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, byId, document };
}

// Fresh static slot per case, exactly as app.html now carries it.
function staticSlot(byId) {
  const fig = new El('figure');
  fig.id = 'headlinerImage'; fig.className = 'headliner-image'; fig.hidden = true;
  const img = new El('img'); img.id = 'headlinerImageImg'; img.alt = '';
  const cap = new El('figcaption'); cap.textContent = 'Image: Qloo';
  fig.appendChild(img); fig.appendChild(cap);
  byId.set('headlinerImage', fig);
  byId.set('headlinerImageImg', img);
  return { fig, img, cap };
}

function verdict(headliner, extraLegs = {}) {
  return { artist: 'Billie Eilish', legs: { describe: { headliner }, ...extraLegs } };
}

test('pin: headliner.image on a Qloo host renders with the honest caption', () => {
  const { sandbox, byId } = buildContext();
  const { fig, img, cap } = staticSlot(byId);
  sandbox.renderHeadlinerImage(verdict({ id: 'h1', name: 'Billie Eilish', image: QLOO_IMG }));
  assert.equal(fig.hidden, false);
  assert.equal(img.src, QLOO_IMG);
  assert.equal(img.alt, 'Billie Eilish');
  assert.equal(cap.textContent, 'Image: Qloo');
});

test('pin: properties.image.url and properties.image string shapes render', () => {
  for (const headliner of [
    { id: 'h1', name: 'Billie Eilish', properties: { image: { url: QLOO_IMG } } },
    { id: 'h1', name: 'Billie Eilish', properties: { image: QLOO_IMG } },
    { id: 'h1', name: 'Billie Eilish', imageUrl: QLOO_IMG_2 },
  ]) {
    const { sandbox, byId } = buildContext();
    const { fig, img } = staticSlot(byId);
    sandbox.renderHeadlinerImage(verdict(headliner));
    assert.equal(fig.hidden, false, `must render for ${JSON.stringify(headliner)}`);
    assert.ok(img.src === QLOO_IMG || img.src === QLOO_IMG_2);
  }
});

test('pin: REST-hydrated entity matching the headliner id renders (old code dropped this)', () => {
  const { sandbox, byId } = buildContext();
  const { fig, img } = staticSlot(byId);
  sandbox.renderHeadlinerImage(verdict(
    { id: 'D7BCE4CD-5135-4608-8A7D-78E08FFD52F3', name: 'Billie Eilish' },
    { restEntities: { status: 'ok', entities: [
      { id: 'D7BCE4CD-5135-4608-8A7D-78E08FFD52F3', properties: { image: { url: QLOO_IMG } } },
    ] } },
  ));
  assert.equal(fig.hidden, false);
  assert.equal(img.src, QLOO_IMG);
});

test('pin: no image anywhere -> slot stays hidden, src cleared, no placeholder', () => {
  const { sandbox, byId } = buildContext();
  const { fig, img } = staticSlot(byId);
  img.src = QLOO_IMG; // stale from a previous verdict must not linger
  sandbox.renderHeadlinerImage(verdict({ id: 'h1', name: 'Billie Eilish' }));
  assert.equal(fig.hidden, true);
  assert.ok(!('src' in img) || img.src === '', 'stale src must be cleared');
});

test('pin: non-Qloo host, http, and other-entity images are never rendered', () => {
  const cases = [
    verdict({ id: 'h1', name: 'Billie Eilish', image: 'https://evil.example.com/x.jpg' }),
    verdict({ id: 'h1', name: 'Billie Eilish', image: 'http://images.qloo.com/i/x.jpg' }),
    verdict({ id: 'h1', name: 'Billie Eilish' }, { restEntities: { status: 'ok', entities: [
      { id: 'other-act', name: 'Some Other Act', properties: { image: { url: QLOO_IMG } } },
    ] } }),
    // Same NAME, different id: name-only match is never enough.
    verdict({ id: 'h1', name: 'Billie Eilish' }, { restEntities: { status: 'ok', entities: [
      { id: 'h2', name: 'Billie Eilish', properties: { image: { url: QLOO_IMG } } },
    ] } }),
  ];
  for (const v of cases) {
    const { sandbox, byId } = buildContext();
    const { fig, img } = staticSlot(byId);
    sandbox.renderHeadlinerImage(v);
    assert.equal(fig.hidden, true, `must not render for ${JSON.stringify(v.legs)}`);
    assert.ok(!('src' in img) || img.src === '');
  }
});

test('pin: failed load hides the slot and clears src (error-remove preserved)', () => {
  const { sandbox, byId } = buildContext();
  const { fig, img } = staticSlot(byId);
  sandbox.renderHeadlinerImage(verdict({ id: 'h1', name: 'Billie Eilish', image: QLOO_IMG }));
  assert.equal(fig.hidden, false);
  assert.equal(typeof img.onerror, 'function');
  img.onerror();
  assert.equal(fig.hidden, true);
  assert.ok(!('src' in img) || img.src === '');
});

test('pin: static slot + CSS contract, and no fake-artist caption anywhere', () => {
  assert.ok(appHtml.includes('<figure id="headlinerImage" class="headliner-image" hidden>'), 'static slot must exist, hidden by default');
  assert.ok(appHtml.includes('<figcaption>Image: Qloo</figcaption>'), 'static caption must be exactly Image: Qloo');
  assert.ok(css.includes('.headliner-image[hidden]'), 'CSS must hide the [hidden] slot');
  assert.ok(css.includes('.headliner-image[hidden] { display: none !important; }'), 'hidden slot must beat any display rule');
  const narrow = css.slice(css.indexOf('@media (max-width: 390px)'));
  assert.ok(narrow.includes('.headliner-image img') && narrow.includes('max-width: 100%'), '390px: image must cap at full width');
  // No generic-photo fallback captioned as an artist, no stock source.
  assert.ok(!/unsplash|pexels/i.test(appJs), 'renderer must not pull a stock photo');
  assert.ok(appJs.includes("cap.textContent = 'Image: Qloo'"), 'every rendered image carries the Qloo caption');
});
