// Artist images: Qloo describe image wired through ONLY for the matched
// headliner, ONLY when it is an https URL on Qloo's own image host.
// Display-only: the image never affects break-even, rank, or any number.
// No image -> no image key at all, so the UI omits the slot entirely.
// A different entity's image is never attached to the headliner.
// No live keys: the pipeline runs against the fixture transports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runVerdict, qlooImageUrl } from '../backend/src/pipeline.js';
import { baseDeps, baseInput, mcpFixture } from './fixtures.js';

const QLOO_IMG = 'https://images.qloo.com/i/test-entity-billie-420x-auto.jpg';

async function runWithDescribe(results) {
  const deps = baseDeps({
    mcpCall: mcpFixture({
      qloo_describe: { status: 'ok', results },
    }),
  });
  const v = await runVerdict(baseInput(), deps);
  assert.equal(v.status, 'verdict');
  return v;
}

test('artist image: valid Qloo image on the headliner is wired through, numbers unchanged', async () => {
  const v = await runWithDescribe([
    { id: 'test-entity-billie', name: 'Billie Eilish', properties: { image: { url: QLOO_IMG } } },
  ]);
  assert.equal(v.legs.describe.headliner.image, QLOO_IMG);
  assert.equal(v.breakEven.tickets, 2084, 'image is display-only: break-even unchanged');
});

test('artist image: headliner without an image carries no image key', async () => {
  const v = await runWithDescribe([
    { id: 'test-entity-billie', name: 'Billie Eilish' },
  ]);
  assert.ok(!('image' in v.legs.describe.headliner), 'no image key means the UI omits the slot');
});

test('artist image: another entity image is never attached to the headliner', async () => {
  const v = await runWithDescribe([
    { id: 'test-entity-billie', name: 'Billie Eilish' },
    { id: 'test-entity-other', name: 'Some Other Act', properties: { image: { url: QLOO_IMG } } },
  ]);
  assert.ok(!('image' in v.legs.describe.headliner), 'a non-headliner result image must never render');
});

test('artist image: invalid image values are rejected, never rendered', () => {
  const bad = [
    { properties: { image: { url: 'http://images.qloo.com/i/x.jpg' } } },
    { properties: { image: { url: 'https://evil.example.com/x.jpg' } } },
    { properties: { image: { url: '' } } },
    { properties: { image: { url: 42 } } },
    { properties: {} },
    {},
    null,
  ];
  for (const item of bad) {
    assert.equal(qlooImageUrl(item), null, `must reject ${JSON.stringify(item)}`);
  }
  assert.equal(qlooImageUrl({ properties: { image: { url: 'https://images.qloo.com/i/x.jpg' } } }), 'https://images.qloo.com/i/x.jpg');
});

test('artist image: frontend renders dynamically with a source tag, never a static photo', () => {
  const appJs = readFileSync(fileURLToPath(new URL('../frontend/app.js', import.meta.url)), 'utf8');
  const appHtml = readFileSync(fileURLToPath(new URL('../frontend/app.html', import.meta.url)), 'utf8');
  const css = readFileSync(fileURLToPath(new URL('../frontend/styles.css', import.meta.url)), 'utf8');
  assert.ok(appJs.includes('function renderHeadlinerImage'), 'dynamic renderer must exist');
  assert.ok(appJs.includes("cap.textContent = 'Image: Qloo'"), 'every rendered image carries a visible source tag');
  assert.ok(appJs.includes("img.onerror = () => { if (typeof fig.remove === 'function') fig.remove(); }"), 'a failed load removes the slot entirely');
  assert.ok(appJs.includes("parsed.hostname.endsWith('.qloo.com')"), 'client re-checks the Qloo host before rendering');
  assert.ok(!appHtml.includes('headlinerImage'), 'no static image slot in app.html — dynamic only');
  assert.ok(css.includes('.headliner-image'), 'image slot must be styled');
});
